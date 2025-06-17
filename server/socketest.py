"""
WebSocket Backend Server - Live API Bridge
This server acts as a bridge between frontend WebSocket clients and the Gemini Live API
"""

import asyncio
import json
import logging
import os
from typing import Dict, Set
import websockets
from websockets.server import WebSocketServerProtocol
from google import genai
from google.genai import types

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class LiveAPIBridge:
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-2.0-flash-live-001"
        self.connected_clients: Set[WebSocketServerProtocol] = set()
        self.active_sessions: Dict[str, any] = {}
        
    async def handle_client_connection(self, websocket: WebSocketServerProtocol, path: str = "/"):
        """Handle new WebSocket client connections using Gemini Live API protocol"""
        client_id = f"client_{id(websocket)}"
        self.connected_clients.add(websocket)
        logger.info(f"Client {client_id} connected from path: {path}")
        try:
            # Wait for setup message
            setup_msg = await websocket.recv()
            setup_data = json.loads(setup_msg)
            if "setup" in setup_data:
                # Parse model and config from setup
                model = setup_data["setup"].get("model", self.model)
                config = setup_data["setup"].get("generationConfig", {"responseModalities": ["TEXT"]})
                system_instruction = setup_data["setup"].get("systemInstruction")
                tools = setup_data["setup"].get("tools")
                session_resumption = setup_data["setup"].get("sessionResumption")
                # Prepare config for Gemini client
                gemini_config = dict(config)
                if system_instruction:
                    gemini_config["system_instruction"] = types.Content(parts=[types.Part(text=system_instruction)])
                if tools:
                    gemini_config["tools"] = tools
                if session_resumption:
                    gemini_config["session_resumption"] = types.SessionResumptionConfig(handle=session_resumption.get("handle"))
                # Start Gemini session
                session_cm = self.client.aio.live.connect(model=model, config=gemini_config)
                session = await session_cm.__aenter__()
                self.active_sessions[client_id] = {
                    "session": session,
                    "session_cm": session_cm,
                    "websocket": websocket,
                    "config": gemini_config,
                    "session_handle": None  # Store session handle for resumption
                }
                await websocket.send(json.dumps({"setupComplete": {}}))
                # Start listening for responses
                asyncio.create_task(self.listen_to_live_api(client_id))
            else:
                await websocket.send(json.dumps({"error": "First message must be setup"}))
                return

            # Main message loop
            async for msg in websocket:
                print(f"[Gemini] Received message from client: {msg}")
                data = json.loads(msg)
                if "clientContent" in data:
                    user_turns = data["clientContent"].get("turns", [])
                    print(f"[Gemini] Forwarding turns to Gemini: {user_turns}")
                    turn_complete = data["clientContent"].get("turnComplete", True)
                    if user_turns and "parts" in user_turns[0] and user_turns[0]["parts"]:
                        turns = [
                            types.Content(
                                role=turn.get("role", "user"),
                                parts=[types.Part(**part) for part in turn.get("parts", [])]
                            )
                            for turn in user_turns
                        ]
                        session = self.active_sessions[client_id]["session"]
                        await session.send_client_content(turns=turns, turn_complete=turn_complete)
                        print(f"[Gemini] Sent turns to Gemini: {turns}")
                elif "realtimeInput" in data:
                    # Handle audio/video/text streaming (not implemented)
                    pass
                elif "toolResponse" in data:
                    # Handle tool/function call responses (not implemented)
                    pass
                # ... handle other message types as needed ...
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client {client_id} disconnected")
        except Exception as e:
            logger.error(f"Error handling client {client_id}: {e}")
        finally:
            self.connected_clients.discard(websocket)
            if client_id in self.active_sessions:
                # Clean up session
                try:
                    session_data = self.active_sessions[client_id]
                    session_cm = session_data["session_cm"]
                    await session_cm.__aexit__(None, None, None)
                except Exception as cleanup_error:
                    logger.error(f"Error cleaning up session for {client_id}: {cleanup_error}")
                del self.active_sessions[client_id]
    
    async def handle_client_message(self, websocket: WebSocketServerProtocol, client_id: str, message: str):
        """Handle messages from WebSocket clients"""
        try:
            data = json.loads(message)
            message_type = data.get("type")
            
            logger.info(f"Received message from {client_id}: {message_type}")
            
            if message_type == "start_session":
                await self.start_live_session(websocket, client_id, data)
            elif message_type == "send_message":
                await self.send_to_live_api(websocket, client_id, data)
            elif message_type == "end_session":
                await self.end_live_session(client_id)
            elif message_type == "configure_session":
                await self.configure_session(websocket, client_id, data)
            else:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Unknown message type: {message_type}"
                }))
                
        except json.JSONDecodeError:
            await websocket.send(json.dumps({
                "type": "error",
                "message": "Invalid JSON format"
            }))
        except Exception as e:
            logger.error(f"Error handling message from {client_id}: {e}")
            await websocket.send(json.dumps({
                "type": "error",
                "message": str(e)
            }))
    
    async def start_live_session(self, websocket: WebSocketServerProtocol, client_id: str, data: dict):
        """Start a new Live API session"""
        try:
            # Configuration from client or default
            config = data.get("config", {"response_modalities": ["TEXT"]})
            
            # Add system instructions if provided
            if "system_instruction" in data:
                config["system_instruction"] = types.Content(
                    parts=[types.Part(text=data["system_instruction"])]
                )
            
            # Add tools if specified
            if data.get("enable_tools"):
                config["tools"] = [
                    {"code_execution": {}},
                    {"google_search": {}}
                ]
            
            logger.info(f"Starting Live API session for {client_id} with config: {config}")
            
            # Create Live API session using async context manager
            session_cm = self.client.aio.live.connect(model=self.model, config=config)
            session = await session_cm.__aenter__()
            self.active_sessions[client_id] = {
                "session": session,
                "session_cm": session_cm,
                "websocket": websocket,
                "config": config
            }
            
            # Start listening for responses
            asyncio.create_task(self.listen_to_live_api(client_id))
            
            await websocket.send(json.dumps({
                "type": "session_started",
                "client_id": client_id,
                "message": "Live API session started successfully"
            }))
            
        except Exception as e:
            logger.error(f"Error starting session for {client_id}: {e}")
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Failed to start session: {str(e)}"
            }))
    
    async def listen_to_live_api(self, client_id: str):
        """Listen for responses from Live API and forward to client"""
        if client_id not in self.active_sessions:
            return
            
        session_data = self.active_sessions[client_id]
        session = session_data["session"]
        websocket = session_data["websocket"]
        
        try:
            async for response in session.receive():
                print(f"[Gemini] Raw response for {client_id}: {response}")
                # Handle session resumption updates
                if hasattr(response, "session_resumption_update") and response.session_resumption_update:
                    print(f"[Gemini] SessionResumptionUpdate: {response.session_resumption_update}")
                    handle = response.session_resumption_update.new_handle
                    resumable = response.session_resumption_update.resumable
                    self.active_sessions[client_id]["session_handle"] = handle
                    await websocket.send(json.dumps({
                        "type": "session_resumption_update",
                        "handle": handle,
                        "resumable": resumable
                    }))
                
                # Handle text responses
                if getattr(response, "text", None) is not None:
                    print(f"[Gemini] Text chunk: {response.text}")
                    await websocket.send(json.dumps({
                        "type": "text_chunk",
                        "content": response.text,
                        "complete": False
                    }))
                
                # Handle server content
                if getattr(response, "server_content", None):
                    print(f"[Gemini] Server content: {response.server_content}")
                    if response.server_content.generation_complete:
                        await websocket.send(json.dumps({
                            "type": "generation_complete",
                            "message": "Response generation completed"
                        }))
                    if response.server_content.interrupted:
                        await websocket.send(json.dumps({
                            "type": "interrupted",
                            "message": "Generation was interrupted"
                        }))
                
                # Handle tool calls
                if hasattr(response, 'tool_call') and response.tool_call:
                    await websocket.send(json.dumps({
                        "type": "tool_call",
                        "tool_call": str(response.tool_call)
                    }))
                
                # Handle usage metadata
                if getattr(response, "usage_metadata", None):
                    usage = response.usage_metadata
                    await websocket.send(json.dumps({
                        "type": "usage_update",
                        "total_tokens": usage.total_token_count,
                        "details": [
                            {
                                "modality": getattr(detail, 'modality', 'unknown'),
                                "token_count": getattr(detail, 'token_count', 0)
                            }
                            for detail in getattr(usage, 'response_tokens_details', [])
                        ]
                    }))
                
                # Handle session warnings
                if hasattr(response, 'go_away') and response.go_away:
                    print(f"[Gemini] go_away for {client_id}: time_left={getattr(response.go_away, 'time_left', None)}")
                    await websocket.send(json.dumps({
                        "type": "session_warning",
                        "message": f"Session ending in: {getattr(response.go_away, 'time_left', None)}",
                        "go_away": str(response.go_away)
                    }))
        except Exception as e:
            print(f"[Gemini] Error listening to Live API for {client_id}: {e}")
            if websocket.close_code is None:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Live API error: {str(e)}"
                }))
        finally:
            # Print WebSocket close reason
            if websocket.close_code is not None:
                print(f"[Gemini] WebSocket closed for {client_id} with code {websocket.close_code} and reason: {getattr(websocket, 'close_reason', None)}")
    
    async def send_to_live_api(self, websocket: WebSocketServerProtocol, client_id: str, data: dict):
        """Send message to Live API"""
        if client_id not in self.active_sessions:
            await websocket.send(json.dumps({
                "type": "error",
                "message": "No active session. Start a session first."
            }))
            return
        
        try:
            session = self.active_sessions[client_id]["session"]
            message = data.get("message", "")
            
            logger.info(f"Sending message to Live API for {client_id}: {message[:50]}...")
            
            # Send to Live API
            await session.send(
                types.Content(
                    role="user",
                    parts=[types.Part(text=message)]
                )
            )
            
            await websocket.send(json.dumps({
                "type": "message_sent",
                "message": "Message sent to Live API"
            }))
            
        except Exception as e:
            logger.error(f"Error sending to Live API for {client_id}: {e}")
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Failed to send message: {str(e)}"
            }))
    
    async def end_live_session(self, client_id: str):
        """End Live API session"""
        if client_id in self.active_sessions:
            try:
                session_data = self.active_sessions[client_id]
                session_cm = session_data["session_cm"]
                websocket = session_data["websocket"]
                logger.info(f"Ending Live API session for {client_id}")
                # Close the Live API session
                await session_cm.__aexit__(None, None, None)
                await websocket.send(json.dumps({
                    "type": "session_ended",
                    "client_id": client_id,
                    "message": "Live API session ended successfully"
                }))
            except Exception as e:
                logger.error(f"Error ending session for {client_id}: {e}")
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Failed to end session: {str(e)}"
                }))
            finally:
                del self.active_sessions[client_id]
    
    async def configure_session(self, websocket: WebSocketServerProtocol, client_id: str, data: dict):
        """Configure session parameters"""
        # For this demo, we'll just acknowledge the configuration
        # In a real implementation, you might restart the session with new config
        await websocket.send(json.dumps({
            "type": "configuration_updated",
            "config": data.get("config", {}),
            "message": "Configuration noted for next session"
        }))

async def main():
    """Main server function"""
    # Get API key from environment variable or use the hardcoded one
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        logger.error("GEMINI_API_KEY environment variable not set")
        return
    
    # Create bridge instance
    bridge = LiveAPIBridge(api_key)
    
    # Start WebSocket server
    host = "localhost"
    port = 8765
    
    logger.info(f"Starting WebSocket server on {host}:{port}")
    
    # Fix: Pass the method directly, websockets will handle the arguments
    server = await websockets.serve(
        bridge.handle_client_connection,
        host,
        port,
        ping_interval=20,
        ping_timeout=10
    )
    
    logger.info("WebSocket server started successfully")
    logger.info("Waiting for client connections...")
    await asyncio.Future()  # Keep server running
    

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server shutting down...")
    except Exception as e:
        logger.error(f"Server error: {e}")