import base64
import asyncio 
import logging
from google import genai
from google.genai import types
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(), logging.FileHandler('audio_service.log')]
)
logger = logging.getLogger(__name__)

class AudioService:
    def __init__(self, api_key, model="gemini-2.0-flash-live-001"):
            logger.info(f"Initializing AudioService with model: {model}")
            
            self.client = genai.Client(api_key=api_key)
            self.model = model
            self.sessions = {}  # Combined session storage
            self.websockets = {}
            self.states = {}  # session states
            self.retry_counts = {}
            self.audio_buffers = {}
            self.client_models = {}  # 🔥 Add this line to track models per client
            self.emotion_service = None  # Initialize this if you have an emotion service
            
            logger.info("AudioService initialized")
    
    async def init_client(self, client_id: str, websocket, model: str = None):
        """Initialize client with retry logic"""
        logger.info(f"Initializing client: {client_id} with model: {model}")
        
        self.websockets[client_id] = websocket
        self.states[client_id] = 'idle'
        self.retry_counts[client_id] = 0
        self.audio_buffers[client_id] = []

        if model:
            self.client_models[client_id] = model
        else:
            self.client_models[client_id] = "gemini-2.0-flash-live-001"  # fallback

        # Initialize with retry
        for attempt in range(3):
            try:
                await self._create_session(client_id)
                logger.info(f"Client {client_id} initialized successfully")
                return
            except Exception as e:
                logger.warning(f"Init attempt {attempt + 1} failed for {client_id}: {e}")
                if attempt == 2:
                    raise
                await asyncio.sleep(1)

    async def _create_session(self, client_id: str):
        """Create Gemini session and start response handler"""
        system_instruction = """You are a compassionate mental health support assistant. 
        Provide empathetic, supportive responses. Keep responses concise for voice interaction.
        Encourage professional help when appropriate."""

        model_to_use = self.client_models.get(client_id, "gemini-2.0-flash-live-001")

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],  # Only audio for now to avoid conflicts
           system_instruction=types.Content(
                parts=[types.Part(text=system_instruction)]
            )
        )

        try:
            session_cm = self.client.aio.live.connect(model=model_to_use, config=config)
            session = await asyncio.wait_for(session_cm.__aenter__(), timeout=30.0)

            self.sessions[client_id] = {'session': session, 'context': session_cm}

            asyncio.create_task(self._handle_responses(client_id))

        except Exception as e:
            logger.error(f"Session creation failed for {client_id}: {e}")
            # Try fallback model if the primary fails
            if "gemini-2.5" in self.model:
                logger.info(f"Trying fallback model for {client_id}")
                fallback_model = "gemini-2.0-flash-live-001"
                config = types.LiveConnectConfig(
                    response_modalities=["AUDIO"],
                    system_instruction=system_instruction
                )
                session_cm = self.client.aio.live.connect(model=fallback_model, config=config)
                session = await asyncio.wait_for(session_cm.__aenter__(), timeout=30.0)
                self.sessions[client_id] = {'session': session, 'context': session_cm}
                asyncio.create_task(self._handle_responses(client_id))
            else:
                raise e
    
    async def _handle_responses(self, client_id: str):
        """Handle responses from Gemini with error recovery"""
        session_data = self.sessions.get(client_id)
        if not session_data:
            return
            
        session = session_data['session']
        consecutive_errors = 0
        
        try:
            async for response in session.receive():
                try:
                    if client_id not in self.websockets:
                        break
                        
                    await self._process_response(client_id, response)
                    consecutive_errors = 0
                    
                except Exception as e:
                    consecutive_errors += 1
                    logger.warning(f"Response processing error for {client_id}: {e}")
                    
                    if consecutive_errors >= 3:
                        raise Exception("Too many consecutive errors")
                        
        except Exception as e:
            logger.error(f"Response handler error for {client_id}: {e}")
            await self._handle_session_error(client_id, str(e))
    
    async def _process_response(self, client_id: str, response):
        """Process different types of responses"""
        websocket = self.websockets.get(client_id)
        if not websocket:
            return
        try:    
            # FIXED: Better response structure handling
            if hasattr(response, 'text') and response.text is not None:
                    await websocket.send_json({
                        "type": "text_response",
                        "content": response.text,
                        "timestamp": datetime.now().isoformat()
                    })
                
                # Handle audio data directly from response
            if hasattr(response, 'data') and response.data is not None:
                    await self._send_audio_response(client_id, response.data)
                
                # Handle server content with proper structure
            if hasattr(response, 'server_content') and response.server_content:
                    server_content = response.server_content
                    
                    # Handle model turn
                    if hasattr(server_content, 'model_turn') and server_content.model_turn:
                        model_turn = server_content.model_turn
                        
                        if hasattr(model_turn, 'parts') and model_turn.parts:
                            for part in model_turn.parts:
                                # Handle text in parts
                                if hasattr(part, 'text') and part.text:
                                    await websocket.send_json({
                                        "type": "text_response",
                                        "content": part.text,
                                        "timestamp": datetime.now().isoformat()
                                    })
                                
                                # Handle inline audio data
                                if hasattr(part, 'inline_data') and part.inline_data:
                                    inline_data = part.inline_data
                                    if hasattr(inline_data, 'data') and inline_data.data:
                                        await self._send_audio_response(client_id, inline_data.data)
                    
                    # Handle turn completion
                    if hasattr(server_content, 'turn_complete') and server_content.turn_complete:
                        self.states[client_id] = 'ready'
                        await websocket.send_json({
                            "type": "turn_complete",
                            "timestamp": datetime.now().isoformat()
                        })
                    
                    # Handle generation complete
                    if hasattr(server_content, 'generation_complete') and server_content.generation_complete:
                        self.states[client_id] = 'ready'
                        await websocket.send_json({
                            "type": "generation_complete",
                            "timestamp": datetime.now().isoformat()
                        })
                    
                    # Handle interruptions
                    if hasattr(server_content, 'interrupted') and server_content.interrupted:
                        await websocket.send_json({
                            "type": "interrupted",
                            "timestamp": datetime.now().isoformat()
                        })
                
                # Handle usage metadata
            if hasattr(response, 'usage_metadata') and response.usage_metadata:
                    usage = response.usage_metadata
                    await websocket.send_json({
                        "type": "usage_update",
                        "total_tokens": usage.total_token_count,
                        "timestamp": datetime.now().isoformat()
                    })
                
        except Exception as e:
            logger.error(f"Error processing response for {client_id}: {e}")
            raise e
    
    
    async def _send_audio_response(self, client_id: str, audio_data: bytes):
        """Send audio response to client"""
        websocket = self.websockets.get(client_id)
        if not websocket or not audio_data:
            return
            
        try:
            # Validate and limit audio size
            max_size = 2 * 1024 * 1024  # 2MB
            if len(audio_data) > max_size:
                audio_data = audio_data[:max_size]
            
            encoded_audio = base64.b64encode(audio_data).decode('utf-8')
            await websocket.send_json({
                "type": "audio_response",
                "content": encoded_audio,
                "size": len(audio_data),
                "format": "pcm",
                "sample_rate": 24000,
                "channels": 1,
                "timestamp": datetime.now().isoformat()
            })
            
        except Exception as e:
            logger.error(f"Failed to send audio for {client_id}: {e}")
    
    async def _handle_session_error(self, client_id: str, error_msg: str):
        """Handle session errors with recovery"""
        self.retry_counts[client_id] = self.retry_counts.get(client_id, 0) + 1

        # Ensure error_msg is a string to prevent NoneType errors
        error_str = str(error_msg) if error_msg is not None else ""

        # Check for connection errors
        if any(indicator in error_str.lower() for indicator in 
            ["1007", "invalid frame payload", "websocket", "connection closed"]):

            if self.retry_counts[client_id] <= 3:
                logger.warning(f"Connection error for {client_id}, attempting recovery")
                await self._recover_session(client_id)
            else:
                await self._send_error(client_id, "Connection failed. Please refresh and try again.")
        else:
            await self._send_error(client_id, f"Session error: {error_str}")

    
    async def _recover_session(self, client_id: str):
        """Recover failed session"""
        try:
            await self._cleanup_session(client_id)
            await asyncio.sleep(2)  # Brief pause
            await self._create_session(client_id)
            self.retry_counts[client_id] = 0
            logger.info(f"Session recovery successful for {client_id}")
        except Exception as e:
            logger.error(f"Session recovery failed for {client_id}: {e}")
            await self._send_error(client_id, "Recovery failed. Please reconnect.")
    
    async def send_audio_chunk(self, client_id: str, audio_data: bytes):
        """Send audio chunk to Gemini"""
        if not audio_data or len(audio_data) == 0:
            return
            
        session_data = self.sessions.get(client_id)
        if not session_data:
            logger.warning(f"No session for {client_id}, initializing...")
            try:
                await self._create_session(client_id)
                session_data = self.sessions.get(client_id)
            except Exception as e:
                await self._send_error(client_id, f"Failed to initialize session: {e}")
                return
        
        try:
            session = session_data['session']
            
            # FIXED: Proper audio input format for Gemini Live API
            # Create the audio blob with correct mime type
            audio_blob = types.Blob(
                data=audio_data, 
                mime_type="audio/pcm;rate=16000"
            )
            
            # Send using the correct API method
            await session.send_realtime_input(audio=audio_blob)
            logger.debug(f"Audio chunk sent for {client_id}: {len(audio_data)} bytes")
                    
            
            
        except Exception as e:
            logger.error(f"Failed to send audio for {client_id}: {e}")
            if "1007" in str(e) or "connection" in str(e).lower():
                await self._handle_session_error(client_id, str(e))
            else:
                await self._send_error(client_id, f"Audio processing failed: {e}")
    
    async def start_recording(self, client_id: str):
        """Start recording session"""
        websocket = self.websockets.get(client_id)
        if not websocket:
            return False
            
        try:
            self.states[client_id] = 'listening'
            await websocket.send_json({
                "type": "recording_started",
                "timestamp": datetime.now().isoformat()
            })
            logger.info(f"Recording started for {client_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to start recording for {client_id}: {e}")
            return False
    
    async def stop_recording(self, client_id: str):
        """Stop recording and end turn"""
        websocket = self.websockets.get(client_id)
        session_data = self.sessions.get(client_id)
        
        if not websocket or not session_data:
            return False
            
        try:
            self.states[client_id] = 'processing'
            session = session_data['session']
            
            await session.send_realtime_input(audio_stream_end=True)
            
            # If using manual VAD, also send activity end:
            # await session.send_realtime_input(activity_end=types.ActivityEnd())
            
            await websocket.send_json({
                "type": "recording_stopped",
                "timestamp": datetime.now().isoformat()
            })
            
            
            self.states[client_id] = 'idle'
            await websocket.send_json({
                "type": "recording_stopped",
                "timestamp": datetime.now().isoformat()
            })
            
            logger.info(f"Recording stopped for {client_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to stop recording for {client_id}: {e}")
            self.states[client_id] = 'idle'
            return False
    
    async def send_text(self, client_id: str, text: str):
        """Send text message to Gemini session"""
        session_data = self.sessions.get(client_id)
        if not session_data:
            logger.error(f"No session found for {client_id}")
            return False
            
        try:
            session = session_data['session']
            
            # FIXED: Proper text input for Live API
            # Create text content
            text_part = types.Part(text=text)
            content = types.Content(parts=[text_part])
            client_content = types.LiveClientContent(content=content)
            
            await session.send(client_content)
            logger.info(f"Text sent for {client_id}: {text[:50]}...")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send text for {client_id}: {e}")
            return False
    
    async def _send_error(self, client_id: str, message: str):
        """Send error message to client"""
        websocket = self.websockets.get(client_id)
        if websocket:
            try:
                await websocket.send_json({
                    "type": "error",
                    "content": message,
                    "timestamp": datetime.now().isoformat()
                })
            except Exception as e:
                logger.error(f"Failed to send error to {client_id}: {e}")
    
    async def _cleanup_session(self, client_id: str):
        """Clean up session for client"""
        session_data = self.sessions.get(client_id)
        if session_data and session_data.get('context'):
            try:
                await session_data['context'].__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Error closing session for {client_id}: {e}")
        
        self.sessions.pop(client_id, None)
        if client_id in self.states:
            self.states[client_id] = 'idle'
    
    def cleanup_client(self, client_id: str):
        """Clean up all client resources"""
        logger.info(f"Cleaning up client: {client_id}")
        
        # Schedule session cleanup
        session_data = self.sessions.get(client_id)
        if session_data:
            asyncio.create_task(self._cleanup_session(client_id))
        
        # Remove from all tracking
        self.sessions.pop(client_id, None)
        self.websockets.pop(client_id, None)
        self.states.pop(client_id, None)
        self.retry_counts.pop(client_id, None)
        # ADDED: Clean up audio buffer
        self.audio_buffers.pop(client_id, None)
        
        logger.info(f"Client {client_id} cleanup completed")
    
    def get_session_status(self, client_id: str) -> dict:
        """Get client session status"""
        return {
            "client_id": client_id,
            "has_session": client_id in self.sessions,
            "has_websocket": client_id in self.websockets,
            "session_state": self.states.get(client_id, "unknown"),
            "retry_count": self.retry_counts.get(client_id, 0),
            "has_audio_buffer": client_id in self.audio_buffers,
            "model": self.model
        }