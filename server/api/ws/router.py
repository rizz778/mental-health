import asyncio
import json
import logging
import base64
import numpy as np
import cv2
from fastapi import WebSocket, APIRouter, Depends
from services.gemini_service import GeminiService
from services.audio_service import AudioService
from google.genai import types
from api.deps import get_gemini_service
from api.deps import get_audio_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/ws', tags=["ws"])

def get_config_from_setup(setup_data, default_model):
    model = setup_data.get("model", default_model)
    config = setup_data.get("generationConfig", {"responseModalities": ["TEXT"]})
    system_instruction = setup_data.get("systemInstruction")
    tools = setup_data.get("tools")
    session_resumption = setup_data.get("sessionResumption")
    gemini_config = dict(config)
    if system_instruction:
        
        gemini_config["system_instruction"] = types.Content(parts=[types.Part(text=system_instruction)])
    if tools:
        gemini_config["tools"] = tools
    if session_resumption:
        gemini_config["session_resumption"] = types.SessionResumptionConfig(handle=session_resumption.get("handle"))
    return model, gemini_config

# Dependency injection for services


@router.websocket("")
async def websocket_endpoint(
    websocket: WebSocket,
    gemini_service: GeminiService = Depends(get_gemini_service),
    audio_service: AudioService = Depends(get_audio_service)
):
    active_sessions = {}
    await websocket.accept()
    client_id = f"client_{id(websocket)}"
    audio_service.init_client(client_id)
    try:
        setup_msg = await websocket.receive_text()
        setup_data = json.loads(setup_msg)
        if "setup" in setup_data:
            model, gemini_config = get_config_from_setup(setup_data["setup"], gemini_service.model)
            session, session_cm = await gemini_service.start_session(gemini_config)
            active_sessions[client_id] = {
                "session": session,
                "session_cm": session_cm,
                "websocket": websocket,
                "config": gemini_config,
                "session_handle": None
            }
            audio_service.gemini_sessions[client_id] = session
            await websocket.send_json({"setupComplete": {}})
            asyncio.create_task(
                gemini_service.receive_responses(session, websocket, client_id, active_sessions)
            )
        else:
            await websocket.send_json({"error": "First message must be setup"})
            return
        while True:
            msg = await websocket.receive_text()
            logger.info(f"[WebSocket] Received message: {msg}")
            try:
                data = json.loads(msg)
                message_type = data.get("type")
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON"})
                continue
            if "clientContent" in data:
                user_turns = data["clientContent"].get("turns", [])
                turn_complete = data["clientContent"].get("turnComplete", True)
                if user_turns and "parts" in user_turns[0] and user_turns[0]["parts"]:
                    try:
                        session = active_sessions[client_id]["session"]
                        await gemini_service.send_client_content(
                            session,
                            user_turns,
                            turn_complete
                        )
                    except Exception as e:
                        logger.error(f"[Gemini] Error sending turns: {e}")
            elif "frame" in data:
                try:
                    frame_b64 = data["frame"]
                    np_arr = np.frombuffer(base64.b64decode(frame_b64), np.uint8)
                    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                    current_emotion = audio_service.emotion_service.analyze_frame(frame)
                    aggregated = audio_service.emotion_service.get_aggregated_emotion()
                    await websocket.send_json({
                        "emotion": {
                            "current": current_emotion,
                            "aggregated": aggregated
                        }
                    })
                except Exception as e:
                    logger.error(f"[Emotion] Error processing frame: {e}")
                    await websocket.send_json({"error": "Emotion processing failed"})
            elif message_type == "audio_chunk":
                audio_data = base64.b64decode(data.get("data", ""))
                if client_id in audio_service.audio_buffers:
                    audio_service.audio_buffers[client_id].append(audio_data)
                await audio_service.send_audio_chunk(client_id, audio_data)
            elif message_type == "start_recording":
                await audio_service.start_recording(client_id)
            elif message_type == "stop_recording":
                await audio_service.stop_recording(client_id)
            elif message_type == "text_message":
                text_content = data.get("content", "")
                if text_content and client_id in audio_service.gemini_sessions:
                    session = audio_service.gemini_sessions[client_id]
                    await session.send(text_content)
            else:
                await websocket.send_json({"error": "Unsupported message format"})
    except Exception as e:
        logger.error(f"Error handling client {client_id}: {e}")
    finally:
        if client_id in active_sessions:
            try:
                session_data = active_sessions[client_id]
                session_cm = session_data["session_cm"]
                await session_cm.__aexit__(None, None, None)
            except Exception as cleanup_error:
                logger.error(f"Error cleaning up session for {client_id}: {cleanup_error}")
            del active_sessions[client_id]
        audio_service.cleanup_client(client_id)
