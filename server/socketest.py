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
        
    async def handle_client_connection(self, websocket: WebSocketServerProtocol, path: str):
        """Handle new WebSocket client connections"""
        client_id = f"client_{id(websocket)}"
        self.connected_clients.add(websocket)
        logger.info(f"Client {client_id} connected")
        
        try:
            # Send welcome message
            await websocket.send(json.dumps({
                "type": "connection_established",
                "client_id": client_id,
                "message": "Connected to Live API Bridge"
            }))
            
            # Handle messages from this client
            async for message in websocket:
                await self.handle_client_message(websocket, client_id, message)
                
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client {client_id} disconnected")
        except Exception as e:
            logger.error(f"Error handling client {client_id}: {e}")
        finally:
            self.connected_clients.discard(websocket)
            if client_id in self.active_sessions:
                # Clean up session
                del self.active_sessions[client_id]
    
    async def handle_client_message(self, websocket: WebSocketServerProtocol, client_id: str, message: str):
        """Handle messages from WebSocket clients"""
        try:
            data = json.loads(message)
            message_type = data.get("type")
            
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
            
            # Create Live API session
            session = await self.client.aio.live.connect(model=self.model, config=config)
            self.active_sessions[client_id] = {
                "session": session,
                "websocket": websocket,
                "config": config
            }
            
            # Start listening for responses
            asyncio.create_task(self.listen_to_live_api(client_id))
            
            await websocket.send(json.dumps({
                "type": "session_started",
                "client_id": client_id,
                "config": config
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
                # Handle text responses
                if response.text is not None:
                    await websocket.send(json.dumps({
                        "type": "text_chunk",
                        "content": response.text,
                        "complete": False
                    }))
                
                # Handle server content
                if response.server_content:
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
                if response.usage_metadata:
                    usage = response.usage_metadata
                    await websocket.send(json.dumps({
                        "type": "usage_update",
                        "total_tokens": usage.total_token_count,
                        "details": [
                            {
                                "modality": getattr(detail, 'modality', 'unknown'),
                                "token_count": getattr(detail, 'token_count', 0)
                            }
                            for detail in usage.response_tokens_details
                        ]
                    }))
                
                # Handle session warnings
                if hasattr(response, 'go_away') and response.go_away:
                    await websocket.send(json.dumps({
                        "type": "session_warning",
                        "message": f"Session ending in: {response.go_away.time_left}"
                    }))
                    
        except Exception as e:
            logger.error(f"Error listening to Live API for {client_id}: {e}")
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Live API error: {str(e)}"
            }))
    
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
            
            # Send to Live API
            await session.send_client_content(
                turns={"role": "user", "parts": [{"text": message}]},
                turn_complete=True
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
                session = session_data["session"]
                websocket = session_data["websocket"]
                
                # Close the Live API session
                await session.__aexit__(None, None, None)
                
                await websocket.send(json.dumps({
                    "type": "session_ended",
                    "message": "Live API session ended"
                }))
                
                del self.active_sessions[client_id]
                
            except Exception as e:
                logger.error(f"Error ending session for {client_id}: {e}")
    
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
    # Get API key from environment variable
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY environment variable not set")
        return
    
    # Create bridge instance
    bridge = LiveAPIBridge(api_key)
    
    # Start WebSocket server
    host = "localhost"
    port = 8765
    
    logger.info(f"Starting WebSocket server on {host}:{port}")
    
    async with websockets.serve(
        bridge.handle_client_connection,
        host,
        port,
        ping_interval=20,
        ping_timeout=10
    ):
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

# Usage Instructions:
# 1. Install dependencies: pip install websockets google-genai
# 2. Set environment variable: export GEMINI_API_KEY="your_api_key_here"
# 3. Run the server: python websocket_server.py
# 4. Connect frontend clients to ws://localhost:8765