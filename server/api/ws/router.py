import asyncio
import json
import logging
import base64
import numpy as np
import cv2
from fastapi import APIRouter, Depends, WebSocket
from services.gemini_service import GeminiService
from services.audio_service import AudioService
from google.genai import types
from api.deps import get_gemini_service
from api.deps import get_audio_service
import websockets

logger = logging.getLogger(__name__)

router = APIRouter(prefix='', tags=["ws"])

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


@router.websocket("/")
async def websocket_endpoint(
    websocket: WebSocket,
    gemini_service: GeminiService = Depends(get_gemini_service),
    audio_service: AudioService = Depends(get_audio_service)
):
    active_sessions = {}
    await websocket.accept()
    client_id = f"client_{id(websocket)}"
   
    # Tasks to track running operations
    text_receive_task = None
    audio_response_task = None
    
    try:
        setup_msg = await websocket.receive_text()
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
                
                # Initialize session based on modalities
                if "TEXT" in response_modalities:
                    # Initialize text-based session
                    session, session_cm = await gemini_service.start_session(gemini_config)
                    
                    active_sessions[client_id] = {
                        "session": session,
                        "session_cm": session_cm,
                        "websocket": websocket,
                        "config": gemini_config,
                        "session_handle": None,
                        "initialized": True,
                        "modalities": response_modalities
                    }
                    
                    # Start text response handler
                    text_receive_task = asyncio.create_task(
                        gemini_service.receive_responses(session, websocket, client_id, active_sessions)
                    )
                    logger.info(f"[WebSocket] Started TEXT modality task for {client_id}")
                
                if "AUDIO" in response_modalities:
                    # Initialize audio session (separate from text session)
                    print(f"🎵 [SETUP] Initializing AUDIO session for {client_id}")
                    logger.info(f"Starting AUDIO session initialization for {client_id}")
                    
                    try:
                        await audio_service.init_client(client_id, websocket)
                        print(f"🎵 [SETUP] AUDIO session initialized for {client_id}")
                        
                        # Verify session was created
                        if client_id in audio_service.gemini_sessions and audio_service.gemini_sessions[client_id]:
                            print(f"✅ [SETUP] AUDIO session verified for {client_id}")
                        else:
                            print(f"⚠️ [SETUP] AUDIO session not found after initialization for {client_id}")
                            
                    except Exception as audio_error:
                        print(f"❌ [SETUP] Failed to initialize AUDIO session for {client_id}: {audio_error}")
                        logger.error(f"Audio session initialization failed for {client_id}: {audio_error}")
                        raise audio_error
                    
                    # If no text session was created, create a minimal session entry
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
                        # Update existing session with audio modality
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
        
        # Main message handling loop
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
            
            # Handle text content for TEXT modality
            if "clientContent" in data:
                user_turns = data["clientContent"].get("turns", [])
                turn_complete = data["clientContent"].get("turnComplete", True)
                
                if user_turns and "parts" in user_turns[0] and user_turns[0]["parts"]:
                    try:
                        # Safely access the session with validation
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
                        else:
                            logger.error(f"[WebSocket] No text session available for {client_id}")
                            await websocket.send_json({"error": "Text session not available"})
                    except Exception as e:
                        logger.error(f"[Gemini] Error sending turns: {e}")
                        await websocket.send_json({"error": f"Failed to send content: {str(e)}"})
            
            # Handle emotion analysis from video frames
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
            
            # Handle audio messages for AUDIO modality
            elif message_type == "audio_chunk":
                print(f"🎵 [WS] Received audio chunk for {client_id}")
                audio_data = base64.b64decode(data.get("data", ""))
                if client_id in audio_service.audio_buffers:
                    audio_service.audio_buffers[client_id].append(audio_data)
                    print(f"🎵 [WS] Audio chunk buffered for {client_id}, buffer size: {len(audio_service.audio_buffers[client_id])}")
                else:
                    print(f"⚠️ [WS] No audio buffer found for {client_id}")
                    
                await audio_service.send_audio_chunk(client_id, audio_data)
            
            elif message_type == "start_recording":
                print(f"🎙️ [WS] Start recording for {client_id}")
                await audio_service.start_recording(client_id)
            
            elif message_type == "stop_recording":
                print(f"🛑 [WS] Stop recording for {client_id}")
                await audio_service.stop_recording(client_id)
            
            elif message_type == "text_message":
                text_content = data.get("content", "")
                if text_content and client_id in audio_service.gemini_sessions:
                    session = audio_service.gemini_sessions[client_id]
                    if session:
                        await session.send(text_content)
                    else:
                        logger.error(f"[WebSocket] No audio session available for {client_id}")
                        await websocket.send_json({"error": "Audio session not available"})
            
            else:
                await websocket.send_json({"error": "Unsupported message format"})
    
    except Exception as e:
        logger.error(f"Error handling client {client_id}: {e}")
    
    finally:
        # Cancel running tasks
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
        
        # Clean up the session
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
            
            # Remove from active sessions
            del active_sessions[client_id]
        
        # Clean up audio service
        audio_service.cleanup_client(client_id)
        logger.info(f"[WebSocket] Cleanup completed for {client_id}")