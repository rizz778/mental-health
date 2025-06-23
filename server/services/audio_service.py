import base64
import asyncio 
import logging
from google import genai
from google.genai import types
from datetime import datetime
import json

# Configure logging with more detailed format
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('audio_service.log')
    ]
)
logger = logging.getLogger(__name__)

class AudioService:
    def __init__(self, api_key, model="gemini-2.0-flash-exp"):
        print("🚀 [INIT] Initializing AudioService...")
        logger.info(f"Initializing AudioService with model: {model}")
        
        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.audio_buffers = {}
        self.gemini_sessions = {}
        self.session_contexts = {}  # Store session context managers
        self.session_states = {}
        self.active_connections = set()  # Track active connections
        self.websockets = {}  # Store websocket references
        self.retry_counts = {}  # Track retry attempts per client
        
        print("✅ [INIT] AudioService initialized successfully")
        logger.info("AudioService initialization completed")
    
    async def init_client(self, client_id: str, websocket):
        """Initialize a new client for audio processing"""
        print(f"👤 [CLIENT] Initializing client: {client_id}")
        logger.info(f"Initializing client: {client_id}")
        
        # Initialize client data structures
        self.audio_buffers[client_id] = []
        self.gemini_sessions[client_id] = None
        self.session_contexts[client_id] = None
        self.session_states[client_id] = 'idle'
        self.active_connections.add(client_id)
        self.websockets[client_id] = websocket
        self.retry_counts[client_id] = 0
        
        print(f"👤 [CLIENT] Client {client_id} initialized")
        print(f"👤 [CLIENT] Active connections: {len(self.active_connections)}")
        logger.info(f"Client {client_id} initialized. Total active: {len(self.active_connections)}")
        
        # Initialize Gemini Live API session with retry logic
        max_retries = 3
        for attempt in range(max_retries):
            try:
                await self._initialize_gemini_session(client_id)
                break
            except Exception as e:
                logger.warning(f"Attempt {attempt + 1} failed for {client_id}: {e}")
                if attempt == max_retries - 1:
                    raise
                await asyncio.sleep(1)  # Wait before retry
        
        # Verify initialization
        if client_id in self.gemini_sessions and self.gemini_sessions[client_id]:
            print(f"✅ [CLIENT] Audio session verified for {client_id}")
            logger.info(f"Audio session successfully verified for {client_id}")
        else:
            print(f"❌ [CLIENT] Audio session verification FAILED for {client_id}")
            logger.error(f"Audio session verification failed for {client_id}")
            raise Exception(f"Failed to initialize audio session for {client_id}")
    
    def get_session_status(self, client_id: str) -> dict:
        """Get the current status of a client's session"""
        return {
            "client_id": client_id,
            "has_session": client_id in self.gemini_sessions and self.gemini_sessions[client_id] is not None,
            "has_websocket": client_id in self.websockets and self.websockets[client_id] is not None,
            "has_buffer": client_id in self.audio_buffers,
            "session_state": self.session_states.get(client_id, "unknown"),
            "is_active": client_id in self.active_connections,
            "retry_count": self.retry_counts.get(client_id, 0)
        }
    
    async def _initialize_gemini_session(self, client_id: str):
        """Initialize Gemini Live API session with improved error handling"""
        print(f"🤖 [GEMINI] Initializing Gemini session for client: {client_id}")
        logger.info(f"Starting Gemini session initialization for client: {client_id}")
        
        # Check if session already exists
        if client_id in self.gemini_sessions and self.gemini_sessions[client_id]:
            print(f"🤖 [GEMINI] Session already exists for {client_id}")
            logger.info(f"Session already exists for client: {client_id}")
            return
        
        try:
            # Simplified system prompt to avoid potential issues
            system_prompt = """You are a compassionate mental health support assistant. 
            
Provide empathetic, supportive responses to users discussing mental health concerns. 
Keep responses concise and conversational for voice interaction.
Encourage professional help when appropriate, especially for crisis situations.
Always be understanding and non-judgmental."""

            print(f"🤖 [GEMINI] Creating live connect config for {client_id}")
            
            # Use a more conservative configuration
            config = types.LiveConnectConfig(
                response_modalities=["AUDIO"],  # Start with audio only
                system_instruction=system_prompt
            )
            
            print(f"🤖 [GEMINI] Starting live session for {client_id}")
            # Start live session with timeout
            session_cm = self.client.aio.live.connect(model=self.model, config=config)
            
            # Add timeout to prevent hanging
            try:
                session = await asyncio.wait_for(session_cm.__aenter__(), timeout=30.0)
            except asyncio.TimeoutError:
                logger.error(f"Session initialization timeout for {client_id}")
                raise Exception("Session initialization timeout")
            
            # Store both session and context manager
            self.gemini_sessions[client_id] = session
            self.session_contexts[client_id] = session_cm
            
            print(f"🤖 [GEMINI] Live session created for {client_id}")
            logger.info(f"Gemini live session created for client: {client_id}")

            # Start listening for responses from Gemini
            print(f"🤖 [GEMINI] Starting response handler task for {client_id}")
            asyncio.create_task(self._handle_gemini_responses(client_id, session))

            print(f"✅ [GEMINI] Session initialized successfully for {client_id}")
            logger.info(f"Gemini session initialized successfully for client {client_id}")

        except Exception as e:
            print(f"❌ [GEMINI] Failed to initialize session for {client_id}: {e}")
            logger.error(f"Failed to initialize Gemini session for {client_id}: {e}")
            
            # Clean up any partial initialization
            if client_id in self.gemini_sessions:
                self.gemini_sessions.pop(client_id, None)
            if client_id in self.session_contexts:
                self.session_contexts.pop(client_id, None)
                
            await self._send_error(client_id, f"Failed to initialize AI session: {str(e)}")
            raise  # Re-raise to let caller handle
    
    async def _handle_gemini_responses(self, client_id: str, live_session):
        """Handle responses from Gemini Live API with better error handling"""
        print(f"🎧 [RESPONSE] Starting response handler for client: {client_id}")
        logger.info(f"Starting Gemini response handler for client: {client_id}")
        
        try:
            response_count = 0
            async for response in live_session.receive():
                response_count += 1
                print(f"🎧 [RESPONSE] Received response #{response_count} for {client_id}")
                
                # Check if client is still active
                if client_id not in self.active_connections:
                    print(f"🎧 [RESPONSE] Client {client_id} no longer active, stopping handler")
                    logger.info(f"Client {client_id} no longer active, stopping response handler")
                    break
                
                # Get websocket for this client
                websocket = self.websockets.get(client_id)
                if not websocket:
                    print(f"🎧 [RESPONSE] No websocket found for {client_id}, stopping handler")
                    logger.warning(f"No websocket found for client {client_id}")
                    break
                
                # Handle server content (text responses)
                if response.server_content:
                    print(f"🎧 [RESPONSE] Processing server content for {client_id}")
                    
                    if response.server_content.model_turn:
                        print(f"🎧 [RESPONSE] Processing model turn for {client_id}")
                        # Handle text response
                        for part_idx, part in enumerate(response.server_content.model_turn.parts):
                            if hasattr(part, 'text') and part.text:
                                print(f"📝 [TEXT] Sending text response to {client_id} (part {part_idx}): {part.text[:50]}...")
                                logger.info(f"Sending text response to {client_id}: {len(part.text)} characters")
                                await websocket.send_json({
                                    "type": "text_response",
                                    "content": part.text,
                                    "timestamp": datetime.now().isoformat()
                                })
                    
                    if response.server_content.turn_complete:
                        print(f"🎧 [RESPONSE] Turn complete for {client_id}")
                        logger.info(f"Turn completed for client {client_id}")
                        # Turn is complete, ready for next user input
                        self.session_states[client_id] = 'listening'
                
                # Handle audio data
                if hasattr(response, 'audio_data') and response.audio_data:
                    audio_size = len(response.audio_data)
                    print(f"🎵 [AUDIO] Sending audio response to {client_id}, size: {audio_size} bytes")
                    logger.info(f"Sending audio response to {client_id}: {audio_size} bytes")
                    
                    await websocket.send_json({
                        "type": "audio_response",
                        "content": base64.b64encode(response.audio_data).decode('utf-8'),
                        "timestamp": datetime.now().isoformat()
                    })
                
        except Exception as e:
            error_msg = str(e)
            print(f"❌ [RESPONSE] Error handling Gemini responses for {client_id}: {error_msg}")
            logger.error(f"Error handling Gemini responses for {client_id}: {error_msg}")
            
            # Check if this is a 1007 error and handle appropriately
            if "1007" in error_msg or "invalid frame payload data" in error_msg:
                print(f"🔄 [RETRY] Detected 1007 error for {client_id}, attempting to reinitialize session")
                logger.warning(f"1007 error detected for {client_id}, attempting recovery")
                
                # Increment retry count
                self.retry_counts[client_id] = self.retry_counts.get(client_id, 0) + 1
                
                if self.retry_counts[client_id] < 3:  # Max 3 retries
                    # Clean up current session
                    await self._cleanup_session_for_client(client_id)
                    
                    # Try to reinitialize after a delay
                    await asyncio.sleep(2)
                    try:
                        await self._initialize_gemini_session(client_id)
                        print(f"✅ [RETRY] Successfully reinitialized session for {client_id}")
                        return  # Exit this handler, new one will be started
                    except Exception as retry_e:
                        logger.error(f"Failed to reinitialize session for {client_id}: {retry_e}")
                        await self._send_error(client_id, f"Session recovery failed: {str(retry_e)}")
                else:
                    await self._send_error(client_id, "Maximum retry attempts reached. Please reconnect.")
            else:
                await self._send_error(client_id, f"AI session error: {error_msg}")
    
    async def _cleanup_session_for_client(self, client_id: str):
        """Clean up session for a specific client without removing from active connections"""
        print(f"🧹 [SESSION] Cleaning up session for client: {client_id}")
        
        if client_id in self.session_contexts and self.session_contexts[client_id]:
            try:
                session_cm = self.session_contexts[client_id]
                await session_cm.__aexit__(None, None, None)
                print(f"🧹 [SESSION] Session context manager closed for {client_id}")
            except Exception as e:
                print(f"⚠️ [SESSION] Error closing session for {client_id}: {e}")
        
        # Remove session references but keep client active
        self.gemini_sessions.pop(client_id, None)
        self.session_contexts.pop(client_id, None)
        self.session_states[client_id] = 'idle'
    
    async def _send_error(self, client_id: str, error_message: str):
        """Send error message to client"""
        try:
            websocket = self.websockets.get(client_id)
            if websocket:
                await websocket.send_json({
                    "type": "error",
                    "content": error_message,
                    "timestamp": datetime.now().isoformat()
                })
        except Exception as e:
            logger.error(f"Failed to send error message to {client_id}: {e}")
    
    async def send_audio_chunk(self, client_id: str, audio_data: bytes):
        """Send audio chunk to Gemini Live API with improved error handling"""
        print(f"🎵 [AUDIO] Sending audio chunk for {client_id}, size: {len(audio_data)} bytes")
        
        # Validate audio data
        if not audio_data or len(audio_data) == 0:
            logger.warning(f"Empty audio data received for {client_id}")
            return
        
        # Check if session exists, if not try to initialize
        if client_id not in self.gemini_sessions or not self.gemini_sessions[client_id]:
            print(f"🤖 [GEMINI] No session found for {client_id}, attempting to initialize...")
            logger.warning(f"No Gemini session available for {client_id}, attempting initialization")
            
            # Try to initialize the session if websocket exists
            if client_id in self.websockets:
                try:
                    await self._initialize_gemini_session(client_id)
                    # Wait a moment for initialization
                    await asyncio.sleep(0.1)
                except Exception as e:
                    logger.error(f"Failed to initialize session for {client_id}: {e}")
                    await self._send_error(client_id, f"Failed to initialize audio session: {str(e)}")
                    return
            else:
                logger.error(f"No websocket available for {client_id}")
                return
        
        # Now try to send the audio chunk
        if client_id in self.gemini_sessions and self.gemini_sessions[client_id]:
            try:
                session = self.gemini_sessions[client_id]
                # Use the correct method with types.Blob
                audio_blob = types.Blob(data=audio_data, mime_type="audio/pcm;rate=16000")
                await session.send_realtime_input(audio=audio_blob)
                logger.info(f"Audio chunk sent to Gemini for {client_id}")
                print(f"✅ [AUDIO] Audio chunk sent successfully for {client_id}")
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Error sending audio chunk for {client_id}: {error_msg}")
                print(f"❌ [AUDIO] Failed to send audio chunk for {client_id}: {error_msg}")
                
                # Check for 1007 error and handle
                if "1007" in error_msg or "invalid frame payload data" in error_msg:
                    print(f"🔄 [AUDIO] 1007 error detected, attempting session recovery for {client_id}")
                    await self._cleanup_session_for_client(client_id)
                    await self._send_error(client_id, "Audio session error, please try again")
                else:
                    await self._send_error(client_id, f"Failed to send audio: {error_msg}")
        else:
            logger.error(f"Still no Gemini session available for {client_id} after initialization attempt")
            print(f"❌ [AUDIO] No session available for {client_id} even after initialization attempt")
            await self._send_error(client_id, "Audio session unavailable")

    async def start_recording(self, client_id: str):
        """Start recording audio for a client"""
        print(f"🎙️ [RECORD] Starting recording for {client_id}")
        logger.info(f"Starting recording for client {client_id}")
        
        self.session_states[client_id] = 'listening'
        self.audio_buffers[client_id] = []
        
        # Notify client that recording started
        websocket = self.websockets.get(client_id)
        if websocket:
            await websocket.send_json({
                "type": "recording_started",
                "timestamp": datetime.now().isoformat()
            })

    async def stop_recording(self, client_id: str):
        """Stop recording and send accumulated audio to Gemini"""
        print(f"🛑 [RECORD] Stopping recording for {client_id}")
        logger.info(f"Stopping recording for client {client_id}")
        
        if client_id in self.gemini_sessions and self.audio_buffers[client_id]:
            self.session_states[client_id] = 'processing'
            
            # Combine all audio chunks
            combined_audio = b''.join(self.audio_buffers[client_id])
            
            if combined_audio:
                print(f"🎵 [AUDIO] Sending combined audio for {client_id}, size: {len(combined_audio)} bytes")
                try:
                    session = self.gemini_sessions[client_id]
                    # Use the correct method with types.Blob
                    audio_blob = types.Blob(data=combined_audio, mime_type="audio/pcm;rate=16000")
                    await session.send_realtime_input(audio=audio_blob)
                    logger.info(f"Combined audio sent to Gemini for {client_id}")
                    
                    # Clear the buffer
                    self.audio_buffers[client_id] = []
                    
                    # Notify client that recording stopped and is being processed
                    websocket = self.websockets.get(client_id)
                    if websocket:
                        await websocket.send_json({
                            "type": "recording_stopped",
                            "timestamp": datetime.now().isoformat()
                        })
                        
                except Exception as e:
                    logger.error(f"Error sending combined audio for {client_id}: {e}")
                    await self._send_error(client_id, f"Failed to process audio: {str(e)}")
            else:
                logger.warning(f"No audio data to send for {client_id}")
        else:
            logger.warning(f"No session or audio buffer available for {client_id}")
    
    def cleanup_client(self, client_id: str):
        """Clean up resources for a client"""
        print(f"🧹 [CLEANUP] Cleaning up client: {client_id}")
        logger.info(f"Cleaning up client: {client_id}")
        
        # Close Gemini session if exists
        if client_id in self.session_contexts and self.session_contexts[client_id]:
            print(f"🧹 [CLEANUP] Closing Gemini session for {client_id}")
            try:
                # Schedule cleanup of session context manager
                session_cm = self.session_contexts[client_id]
                asyncio.create_task(self._cleanup_session(session_cm))
            except Exception as e:
                print(f"⚠️ [CLEANUP] Error scheduling session cleanup: {e}")
                logger.warning(f"Error scheduling session cleanup for {client_id}: {e}")
        
        # Remove from tracking dictionaries
        self.audio_buffers.pop(client_id, None)
        self.gemini_sessions.pop(client_id, None)
        self.session_contexts.pop(client_id, None)
        self.session_states.pop(client_id, None)
        self.websockets.pop(client_id, None)
        self.retry_counts.pop(client_id, None)
        self.active_connections.discard(client_id)
        
        print(f"🧹 [CLEANUP] Client {client_id} cleaned up")
        print(f"👤 [CLIENT] Remaining active connections: {len(self.active_connections)}")
        logger.info(f"Client {client_id} cleanup completed. Remaining active: {len(self.active_connections)}")
    
    async def _cleanup_session(self, session_cm):
        """Clean up session context manager"""
        try:
            await session_cm.__aexit__(None, None, None)
            print("🧹 [CLEANUP] Session context manager closed successfully")
        except Exception as e:
            print(f"⚠️ [CLEANUP] Error closing session context manager: {e}")
            logger.warning(f"Error closing session context manager: {e}")