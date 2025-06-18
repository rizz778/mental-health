import asyncio
import json
import logging
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

class WebSocketHandler:
    def __init__(self, gemini_service, active_sessions):
        self.gemini_service = gemini_service
        self.active_sessions = active_sessions

    async def handle_client_connection(self, websocket, path="/"):
        client_id = f"client_{id(websocket)}"
        logger.info(f"Client {client_id} connected from path: {path}")
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
                await websocket.send(json.dumps({"setupComplete": {}}))
                asyncio.create_task(self.gemini_service.receive_responses(session, websocket, client_id, self.active_sessions))
            else:
                await websocket.send(json.dumps({"error": "First message must be setup"}))
                return

            async for msg in websocket:
                logger.info(f"[Gemini] Received message from client: {msg}")
                data = json.loads(msg)
                if "clientContent" in data:
                    user_turns = data["clientContent"].get("turns", [])
                    logger.info(f"[Gemini] Forwarding turns to Gemini: {user_turns}")
                    turn_complete = data["clientContent"].get("turnComplete", True)
                    if user_turns and "parts" in user_turns[0] and user_turns[0]["parts"]:
                        try:
                            await self.gemini_service.send_client_content(self.active_sessions[client_id]["session"], user_turns, turn_complete)
                            logger.info(f"[Gemini] Sent turns to Gemini: {user_turns}")
                        except Exception as e:
                            logger.error(f"[Gemini] ERROR constructing or sending turns: {e}")
                # ... handle other message types as needed ...
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
