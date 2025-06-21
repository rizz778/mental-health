import base64
import asyncio 
import logging
from google import genai
from google.genai import types
from datetime import datetime


 #Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

    
    async def _initialize_gemini_session(self, client_id: str):
        """Initialize Gemini Live API session"""
        try:
            # Mental health system prompt
            system_prompt = """You are a compassionate mental health support chatbot. Your role is to:

1. Provide empathetic, non-judgmental support to users discussing mental health concerns
2. Listen actively and validate the user's feelings and experiences
3. Offer coping strategies, mindfulness techniques, and general wellness advice
4. Encourage professional help when appropriate, especially for crisis situations
5. Maintain boundaries - you are a support tool, not a replacement for professional therapy
6. Keep responses concise but warm, suitable for spoken conversation
7. If someone expresses suicidal thoughts or immediate danger, encourage them to contact emergency services or crisis hotlines

Important guidelines:
- Always be compassionate and understanding
- Avoid giving specific medical or psychiatric advice
- Focus on emotional support and general wellness strategies
- Keep responses conversational and natural for voice interaction
- If you detect a crisis situation, prioritize safety resources

Remember: You're having a voice conversation, so keep responses natural and spoken-word friendly."""

            # Configure the model for mental health support
            client = genai.Client(api_key='AIzaSyA7305RGIlw82ON0bC994O_YHh4Kklc_aI')

        # Configure for live audio interaction
            config = types.LiveConnectConfig(
            response_modalities=["AUDIO", "TEXT"],
            speech_config={
                "voice_config": {
                    "prebuilt_voice_config": {
                        "voice_name": "Aoede"
                    }
                }
            },
            system_instruction=system_prompt
        )
            
            # Start live session
            session_cm = client.aio.live.connect(model="gemini-2.0-flash-exp", config=config)
            session = await session_cm.__aenter__()
            self.gemini_sessions[client_id] = session

        # Start listening for responses from Gemini
            asyncio.create_task(self._handle_gemini_responses(client_id, session))

            logger.info(f"Gemini session initialized for client {client_id}")

        except Exception as e:
            logger.error(f"Failed to initialize Gemini session for {client_id}: {e}")
            await self._send_error(client_id, f"Failed to initialize AI session: {str(e)}")
    
    async def _handle_gemini_responses(self, client_id: str, live_session):
        """Handle responses from Gemini Live API"""
        try:
            async for response in live_session.receive():
                if client_id not in self.active_connections:
                    break
                
                if response.server_content:
                    if response.server_content.model_turn:
                        # Handle text response
                        for part in response.server_content.model_turn.parts:
                            if hasattr(part, 'text') and part.text:
                                await self._send_message(client_id, {
                                    "type": "text_response",
                                    "content": part.text,
                                    "timestamp": datetime.now().isoformat()
                                })
                    
                    if response.server_content.turn_complete:
                        # Turn is complete, ready for next user input
                        self.session_states[client_id] = 'listening'
                
                # Handle audio data
                if hasattr(response, 'audio_data') and response.audio_data:
                    await self._send_message(client_id, {
                        "type": "audio_response",
                        "content": base64.b64encode(response.audio_data).decode('utf-8'),
                        "timestamp": datetime.now().isoformat()
                    })
                
        except Exception as e:
            logger.error(f"Error handling Gemini responses for {client_id}: {e}")
            await self._send_error(client_id, f"AI session error: {str(e)}")
    

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
