import asyncio
import json
import logging
import base64
import numpy as np
import cv2
from fastapi import APIRouter, Depends, WebSocket
from services.gemini_service import GeminiService
from services.audio_service import AudioService
from services.distress_service import DistressScoreService
from google.genai import Client as GeminiClient
from google.genai import types
from api.deps import get_gemini_service
from api.deps import get_audio_service
from api.deps import get_distress_service
import websockets

logger = logging.getLogger(__name__)

router = APIRouter(prefix='', tags=["ws"])

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


# ... (imports and setup unchanged)

@router.websocket("/")
async def websocket_endpoint(
    websocket: WebSocket,
    gemini_service: GeminiService = Depends(get_gemini_service),
    audio_service: AudioService = Depends(get_audio_service),
    distress_service: DistressScoreService = Depends(get_distress_service)
):
    active_sessions = {}
    await websocket.accept()
    client_id = f"client_{id(websocket)}"
   
    text_receive_task = None
    audio_response_task = None
    
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
                
                if "AUDIO" in response_modalities:
                    print(f"🎵 [SETUP] Initializing AUDIO session for {client_id}")
                    logger.info(f"Starting AUDIO session initialization for {client_id}")
                    
                    try:
                        await audio_service.init_client(client_id, websocket, model=model)
                        print(f"🎵 [SETUP] AUDIO session initialized for {client_id}")
                        
                        # FIX: Only check for presence and non-None session object
                        if client_id in audio_service.sessions and audio_service.sessions[client_id]:
                            print(f"✅ [SETUP] AUDIO session verified for {client_id}")
                        else:
                            print(f"⚠️ [SETUP] AUDIO session not found after initialization for {client_id}")
                            
                    except Exception as audio_error:
                        print(f"❌ [SETUP] Failed to initialize AUDIO session for {client_id}: {audio_error}")
                        logger.error(f"Audio session initialization failed for {client_id}: {audio_error}")
                        raise audio_error
                    
                    if client_id not in active_sessions:
                        active_sessions[client_id] = {
                            "session": None,
                            "session_cm": None,
                            "websocket": websocket,
                            "config": gemini_config,
                            "session_handle": None,
                            "initialized": True,
                            "modalities": response_modalities
                        }
                    else:
                        active_sessions[client_id]["modalities"] = response_modalities
                    
                    logger.info(f"[WebSocket] Initialized AUDIO modality session for {client_id}")
                
                await websocket.send_json({"setupComplete": {}})
                
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
            
            if "clientContent" in data:
                user_turns = data["clientContent"].get("turns", [])
                turn_complete = data["clientContent"].get("turnComplete", True)
                if user_turns and "parts" in user_turns[0] and user_turns[0]["parts"]:
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
                print(f"🎵 [WS] Received audio chunk for {client_id}")
                audio_data = base64.b64decode(data.get("data", ""))
                await audio_service.send_audio_chunk(client_id, audio_data)
            
            elif message_type == "start_recording":
                print(f"🎙️ [WS] Start recording for {client_id}")
                success = await audio_service.start_recording(client_id)
                if not success:
                    await websocket.send_json({"error": "Failed to start recording"})
            
            elif message_type == "stop_recording":
                print(f"🛑 [WS] Stop recording for {client_id}")
                success = await audio_service.stop_recording(client_id)
                if not success:
                    await websocket.send_json({"error": "Failed to stop recording"})
            
            elif message_type == "text_message":
                text_content = data.get("content", "")
                if text_content:
                    # FIX: Use the session object directly
                    session = audio_service.sessions.get(client_id)
                    if session:
                        try:
                            # Send text to audio session using appropriate method
                            if hasattr(session, 'send_text'):
                                await session.send_text(text_content)
                            elif hasattr(session, 'send'):
                                await session.send(text_content)
                            else:
                                await session.send_realtime_input(text=text_content)
                        except Exception as e:
                            logger.error(f"Failed to send text to audio session for {client_id}: {e}")
                            await websocket.send_json({"error": "Failed to send text message"})
                    else:
                        logger.error(f"[WebSocket] No audio session available for {client_id}")
                        await websocket.send_json({"error": "Audio session not available"})
            
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
        
        if audio_response_task and not audio_response_task.done():
            audio_response_task.cancel()
            try:
                await audio_response_task
            except asyncio.CancelledError:
                pass
            except Exception as task_error:
                logger.error(f"Error cancelling audio response task for {client_id}: {task_error}")
        
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
        
        audio_service.cleanup_client(client_id)
        logger.info(f"[WebSocket] Cleanup completed for {client_id}")
