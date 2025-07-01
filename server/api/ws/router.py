import asyncio
import json
import logging
import base64
import numpy as np
import cv2
from fastapi import APIRouter, Depends, WebSocket
from services.emotion_service import EmotionService
from services.gemini_service import GeminiService
from services.audio_service import AudioConnectionManager

from google.genai import types
from api.deps import get_gemini_service
from api.deps import get_emotion_service
import websockets

logger = logging.getLogger(__name__)

router = APIRouter(prefix='', tags=["ws"])

def is_valid_turn(turn):
    return (
        isinstance(turn, dict)
        and "role" in turn
        and "parts" in turn
        and isinstance(turn["parts"], list)
        and all(isinstance(part, dict) and "text" in part for part in turn["parts"])
    )

def get_config_from_setup(setup_data, default_model):
    print("[DEBUG] setup_data received:", setup_data)
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


@router.websocket("/")
async def websocket_endpoint(
    websocket: WebSocket,
    gemini_service: GeminiService = Depends(get_gemini_service),
    emotion_service: EmotionService = Depends(get_emotion_service)
):
    active_sessions = {}
    await websocket.accept()
    client_id = f"client_{id(websocket)}"
   
    text_receive_task = None
    
    try:
        try:
            setup_msg = await websocket.receive_text()
        except Exception as e:
            logger.warning(f"[WebSocket] Client {client_id} disconnected before sending setup: {e}")
            return 
        try:
            setup_data = json.loads(setup_msg)
        except json.JSONDecodeError:
            await websocket.send_json({"error": "Invalid JSON in setup message"})
            return
        
        if not isinstance(setup_data, dict):
            await websocket.send_json({"error": "Setup message must be a JSON object"})
            return
        
        if "setup" in setup_data:
            try:
                model, gemini_config = get_config_from_setup(setup_data["setup"], gemini_service.model)
                response_modalities = gemini_config.get("responseModalities", ["TEXT"])
                
                if "TEXT" in response_modalities:
                    session, session_cm = await gemini_service.start_session(gemini_config, model=model)
                    active_sessions[client_id] = {
                        "session": session,
                        "session_cm": session_cm,
                        "websocket": websocket,
                        "config": gemini_config,
                        "session_handle": None,
                        "initialized": True,
                        "modalities": response_modalities
                    }
                    text_receive_task = asyncio.create_task(
                        gemini_service.receive_responses(session, websocket, client_id, active_sessions)
                    )
                    logger.info(f"[WebSocket] Started TEXT modality task for {client_id}")
                
                await websocket.send_json({"type": "setup_complete"})
                
            except Exception as session_error:
                logger.error(f"[WebSocket] Failed to initialize session for {client_id}: {session_error}")
                await websocket.send_json({"error": f"Session initialization failed: {str(session_error)}"})
                return
        else:
            await websocket.send_json({"error": "First message must be setup"})
            return
        
        while True:
            msg = await websocket.receive_text()
            logger.info(f"[WebSocket] Received message: {msg}")
            
            try:
                data = json.loads(msg)
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON"})
                continue
            
            if not isinstance(data, dict):
                await websocket.send_json({"error": "Message must be a JSON object"})
                continue
            
            message_type = data.get("type")
            
            # ...existing code...

            if "clientContent" in data:
                user_turns = data["clientContent"].get("turns", [])
                turn_complete = data["clientContent"].get("turnComplete", True)
                user_emotion = data["clientContent"].get("emotion")

                # Inject emotion as a system message if present
                if user_emotion:
                    emotion_context = {
                        "role": "user",
                        "parts": [
                            {
                                "text": f"[User's current emotion detected: {user_emotion}]"
                            }
                        ]
                    }
                    # Insert at the start of the turns list
                    user_turns = [emotion_context] + user_turns

                if user_turns and all(is_valid_turn(turn) for turn in user_turns):
                    try:
                        if (client_id in active_sessions and 
                            isinstance(active_sessions[client_id], dict) and 
                            active_sessions[client_id].get("initialized", False) and
                            active_sessions[client_id]["session"] is not None):

                            session = active_sessions[client_id]["session"]
                            await gemini_service.send_client_content(
                                session,
                                user_turns,
                                turn_complete
                            )
                            user_messages = []
                            for turn in user_turns:
                                if turn.get("role") == "user":
                                    for part in turn.get("parts", []):
                                        user_messages.append({"type": "user", "content": part.get("text", "")})

                            async def send_distress_score():
                                score = await distress_service.calculate_distress_score(user_messages)
                                if score is not None:
                                    await websocket.send_json({
                                            "type": "distress_score",
                                            "score": score
                                        })

                            asyncio.create_task(send_distress_score())
                        else:
                            logger.error(f"[WebSocket] No text session available for {client_id}")
                            await websocket.send_json({"error": "Text session not available"})
                    except Exception as e:
                        logger.error(f"[Gemini] Error sending turns: {e}")
                        await websocket.send_json({"error": f"Failed to send content: {str(e)}"})
                else:
                    logger.error(f"[Gemini] Invalid user_turns structure: {pprint.pformat(user_turns)}")
                    await websocket.send_json({"error": "Invalid message format for Gemini"}) 
                        
            elif "frame" in data:
                try:
                    frame_b64 = data["frame"]
                    np_arr = np.frombuffer(base64.b64decode(frame_b64), np.uint8)
                    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                    current_emotion = emotion_service.analyze_frame(frame)
                    aggregated = emotion_service.get_aggregated_emotion()
                    # Only log the captured emotion
                    logger.info(f"[Emotion] Captured: current={current_emotion}, aggregated={aggregated}")
                    await websocket.send_json({
                        "emotion": {
                            "current": current_emotion,
                            "aggregated": aggregated
                        }
                    })
                except Exception as e:
                    await websocket.send_json({"error": "Emotion processing failed"})
            else:
                await websocket.send_json({"error": "Unsupported message format"})
    
    except Exception as e:
        logger.error(f"Error handling client {client_id}: {e}")
    
    finally:
        if text_receive_task and not text_receive_task.done():
            text_receive_task.cancel()
            try:
                await text_receive_task
            except asyncio.CancelledError:
                pass
            except Exception as task_error:
                logger.error(f"Error cancelling text receive task for {client_id}: {task_error}")
        
        if client_id in active_sessions:
            try:
                session_data = active_sessions[client_id]
                if isinstance(session_data, dict) and "session_cm" in session_data and session_data["session_cm"]:
                    session_cm = session_data["session_cm"]
                    await session_cm.__aexit__(None, None, None)
                else:
                    logger.info(f"[WebSocket] No session context manager to clean up for {client_id}")
            except Exception as cleanup_error:
                logger.error(f"Error cleaning up session for {client_id}: {cleanup_error}")
            del active_sessions[client_id]
        
        logger.info(f"[WebSocket] Cleanup completed for {client_id}")

audio_manager = AudioConnectionManager()

@router.websocket("/audio")
async def audio_websocket_endpoint(websocket: WebSocket):
    
    try:
        await audio_manager.connect(websocket)
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            gemini_client = audio_manager.active_connections.get(websocket)
            if not gemini_client:
                await websocket.close(code=1008, reason="Gemini client not found")
                break
            if message["type"] == "setup":
                config = message.get("config", {})
                await gemini_client.send_setup(config)
            elif message["type"] == "audio_input":
                audio_data = message.get("audio_data", "")
                if audio_data:
                    await gemini_client.send_audio(audio_data)
            elif message["type"] == "text_input":
                text = message.get("text", "")
                if text:
                    await gemini_client.send_text(text)
            else:
                logger.warning(f"Unknown message type: {message['type']}")
    except Exception:
        await audio_manager.disconnect(websocket)
