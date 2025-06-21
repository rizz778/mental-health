import asyncio
import json
import logging
import base64
import numpy as np
import cv2

from services.gemini_service import GeminiService

logger = logging.getLogger(__name__)

def get_config_from_setup(setup_data, default_model):
    model = setup_data.get("model", default_model)
    config = setup_data.get("generationConfig", {"responseModalities": ["TEXT"]})
    system_instruction = setup_data.get("systemInstruction")
    tools = setup_data.get("tools")
    session_resumption = setup_data.get("sessionResumption")
    gemini_config = dict(config)

    if system_instruction:
        from google.genai import types
        gemini_config["system_instruction"] = types.Content(parts=[types.Part(text=system_instruction)])
    if tools:
        gemini_config["tools"] = tools
    if session_resumption:
        from google.genai import types
        gemini_config["session_resumption"] = types.SessionResumptionConfig(handle=session_resumption.get("handle"))
    return model, gemini_config

# --- Audio/recording manager for Gemini audio streaming ---
class AudioSessionManager:
    def __init__(self):
        self.audio_buffers = {}
        self.gemini_sessions = {}
        self.session_states = {}

    def init_client(self, client_id):
        self.audio_buffers[client_id] = []
        self.gemini_sessions[client_id] = None
        self.session_states[client_id] = 'idle'

    def cleanup_client(self, client_id):
        self.audio_buffers.pop(client_id, None)
        self.gemini_sessions.pop(client_id, None)
        self.session_states.pop(client_id, None)

    async def send_audio_chunk(self, client_id, audio_data):
        if client_id in self.gemini_sessions and self.gemini_sessions[client_id]:
            session = self.gemini_sessions[client_id]
            await session.send(audio_data, mime_type="audio/webm")

    async def start_recording(self, client_id):
        self.session_states[client_id] = 'listening'
        self.audio_buffers[client_id] = []

    async def stop_recording(self, client_id):
        if client_id in self.gemini_sessions and self.audio_buffers[client_id]:
            self.session_states[client_id] = 'processing'
            combined_audio = b''.join(self.audio_buffers[client_id])
            if combined_audio:
                session = self.gemini_sessions[client_id]
                await session.send(combined_audio, mime_type="audio/webm")
                self.audio_buffers[client_id] = []

# --- WebSocketHandler update ---
class WebSocketHandler:
    def __init__(self, gemini_service: GeminiService, active_sessions: dict, audio_manager: AudioSessionManager):
        self.gemini_service = gemini_service
        self.active_sessions = active_sessions
        self.audio_manager = audio_manager

    async def handle_client_connection(self, websocket, path="/"):
        client_id = f"client_{id(websocket)}"
        logger.info(f"Client {client_id} connected from path: {path}")
        self.audio_manager.init_client(client_id)
        try:
            setup_msg = await websocket.recv()
            setup_data = json.loads(setup_msg)

            if "setup" in setup_data:
                model, gemini_config = get_config_from_setup(setup_data["setup"], self.gemini_service.model)
                session, session_cm = await self.gemini_service.start_session(gemini_config)
                self.active_sessions[client_id] = {
                    "session": session,
                    "session_cm": session_cm,
                    "websocket": websocket,
                    "config": gemini_config,
                    "session_handle": None
                }
                self.audio_manager.gemini_sessions[client_id] = session
                await websocket.send(json.dumps({"setupComplete": {}}))
                asyncio.create_task(
                    self.gemini_service.receive_responses(session, websocket, client_id, self.active_sessions)
                )
            else:
                await websocket.send(json.dumps({"error": "First message must be setup"}))
                return

            async for msg in websocket:
                logger.info(f"[WebSocket] Received message: {msg}")
                try:
                    data = json.loads(msg)

                    message_type = data.get("type")
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({"error": "Invalid JSON"}))
                    continue

                # 1. Text input for Gemini
                if "clientContent" in data:
                    user_turns = data["clientContent"].get("turns", [])
                    turn_complete = data["clientContent"].get("turnComplete", True)
                    if user_turns and "parts" in user_turns[0] and user_turns[0]["parts"]:
                        try:
                            # Always fetch the latest session (for forced reconnect/heartbeat)
                            session = self.active_sessions[client_id]["session"]
                            await self.gemini_service.send_client_content(
                                session,
                                user_turns,
                                turn_complete
                            )
                        except Exception as e:
                            logger.error(f"[Gemini] Error sending turns: {e}")

                # 2. Emotion frame (base64-encoded)
                elif "frame" in data:
                    try:
                        frame_b64 = data["frame"]
                        np_arr = np.frombuffer(base64.b64decode(frame_b64), np.uint8)
                        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

                        current_emotion = self.emotion_service.analyze_frame(frame)
                        aggregated = self.emotion_service.get_aggregated_emotion()

                        await websocket.send(json.dumps({
                            "emotion": {
                                "current": current_emotion,
                                "aggregated": aggregated
                            }
                        }))
                    except Exception as e:
                        logger.error(f"[Emotion] Error processing frame: {e}")
                        await websocket.send(json.dumps({"error": "Emotion processing failed"}))
                elif message_type == "audio_chunk":
                    # Decode base64 audio data
                    audio_data = base64.b64decode(data.get("data", ""))
                    if client_id in self.audio_manager.audio_buffers:
                        self.audio_manager.audio_buffers[client_id].append(audio_data)
                    # Send real-time audio chunk to Gemini
                    await self.audio_manager.send_audio_chunk(client_id, audio_data)
                
                elif message_type == "start_recording":
                    await self.audio_manager.start_recording(client_id)
                
                elif message_type == "stop_recording":
                    await self.audio_manager.stop_recording(client_id)
                
                elif message_type == "text_message":
                    # Handle text input (fallback)
                    text_content = data.get("content", "")
                    if text_content and client_id in self.audio_manager.gemini_sessions:
                        session = self.audio_manager.gemini_sessions[client_id]
                        await session.send(text_content)
                
                # 3. Other unsupported message types
                else:
                    await websocket.send(json.dumps({"error": "Unsupported message format"}))

        except Exception as e:
            logger.error(f"Error handling client {client_id}: {e}")
        finally:
            if client_id in self.active_sessions:
                try:
                    session_data = self.active_sessions[client_id]
                    session_cm = session_data["session_cm"]
                    await session_cm.__aexit__(None, None, None)
                except Exception as cleanup_error:
                    logger.error(f"Error cleaning up session for {client_id}: {cleanup_error}")
                del self.active_sessions[client_id]
            self.audio_manager.cleanup_client(client_id)
