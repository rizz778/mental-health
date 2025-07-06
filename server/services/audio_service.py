import asyncio
import json
import logging
import os
import websockets
from fastapi import WebSocket
from typing import Dict, Any
import google.auth.transport.requests
from google.oauth2 import service_account

logger = logging.getLogger(__name__)

SERVICE_ACCOUNT_FILE = os.getenv("GEMINI_SERVICE_ACCOUNT_FILE", "service.json")
SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/generative-language"
]

def get_access_token():
    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES
    )
    if not credentials.valid or credentials.expired:
        credentials.refresh(google.auth.transport.requests.Request())
    return credentials.token

class GeminiAudioService:
    def __init__(self):
        self.api_key = 'ya29.c.c0ASRK0Gb9RvZMTZVXOEUwVdXnCQiipOOj4X6oWxSc7IXpjEdNkGCbF964GsUMWaFZUCiKysGMh0S3g3D5j_60fNjKP9cQkZziP7a36GpHUfDq1NsjmHMGudVLcA8ZvqAaypa6ykp0sEwKGUdz613MiLclJPdbKrFYcf-VAOgbsk8C2fpGtCsu-5dB5wfMXujVrPBzYoKRSwNi6gByIEVa43GySOC8XpmF9iCYn1jTvEMfepVEKOj1rCQKgX2hf5c4A5ZKXAz8ooltyyQFbYMGhhGbVwOahI44iI2Ose_n3ub_pZo_b4EOy29osSycvtZofS-gP_jpvP1Jbmq6Tze5yGgjCFQ1os_mFUZD0AcE_tIJr_Nmru3Y5LJKiv1jT389DVvdpQ_06Mr5nUmYVygcOcO5b_SWnRd5giyQ4zlslk-IdyuOSqt-5YlRYYghjkoXZ7m8quZexVi7Vx5J-J3Jr6uqaiUxmRh3fshYxI_wyrhWJ5kcn88Uogu7SoYsV9dBzmy1sWoohZ83gvzb7cnwWXg6e9xgpxzz-XZ7zemjsS4-cZtQ_wmo4Fqu-wdSIjBQufmRrz84gwlj7uRdzrnbm2RojOtef7aIOur2cFiUgrBFxXZ_vnb-SyjU5n119rI7kbeU5IS-8Zties3c0UrqJhJzcmpcagYpYexf4ZM7jOdiIvahlkRhcsWR6XsBUR9Ibnbfk1eb_2mh6bUzS6hVlnpfYSlcijBrO3sc8WMsy1y1z1axzn-Sppi2rBg6w9R60Fqh3oyMhvy4cWOwxVIq4pn4if_vu4hhgnWk-05n59j5ROW-ezUstBV78Yir0uspzQ62ucB4sIBW6xoxngoI99xpxvjne7y2YqpupBwlw6p88YjFjYna-sVqoi9wbdz1cR3Q31Q9jcavYbIJ9pdx3XsgX56Ot3Orp-oRV1stYb2jujYVwWqhcYcsfhn6uheFQeYljzvlpq4VmjMx9SqVJXpsFRWptM4oxwIQtF1xhpRSx6Vh0z_YxrB'
        self.websocket = None
        self.connected = False
        self.config = None
        
    async def connect(self):
        url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        logger.info("[GeminiAudioService] Connecting to Gemini WebSocket...")
        self.websocket = await websockets.connect(url, additional_headers=headers)
        self.connected = True
        logger.info("[GeminiAudioService] Connected to Gemini WebSocket.")

    async def send_setup(self, config: Dict[str, Any],system_prompt):
        logger.info(f"[GeminiAudioService] Sending setup: {config}")
        # Synthetic multi-turn conversation history with emotion context
        setup_message = {
            "setup": {
                "model": config.get("model", "models/gemini-2.5-flash-preview-native-audio-dialog"),
                "generationConfig": {
                    "responseModalities": config.get("response_modalities", ["AUDIO"]),
                    "speechConfig": {
                        "voiceConfig": {
                            "prebuiltVoiceConfig": {
                                "voiceName": config.get("voice_name", "Puck")
                            }
                        }
                    }
                },
                "inputAudioTranscription": {},
                "outputAudioTranscription": {},
                "systemInstruction": {
                    "parts": [{ "text": system_prompt }]
                },
                "tools": []
            }
        }
        await self.websocket.send(json.dumps(setup_message))
        logger.info("[GeminiAudioService] Setup message sent.")

    async def send_audio(self, audio_data: str):
        """Send audio data to Gemini using realtime input"""
        if not self.connected or not self.websocket:
            raise Exception("Not connected to Gemini Live API")
        print(f"🎵 Sending audio data to Gemini, size: {len(audio_data)} chars")
        message = {
            "realtimeInput": {
                "mediaChunks": [
                    {
                        "mimeType": "audio/pcm;rate=16000",
                        "data": audio_data
                    }
                ]
            }
        }
        print(f"📤 Audio message structure: {json.dumps({k: v if k != 'data' else f'[{len(v)} chars]' for k, v in message['realtimeInput']['mediaChunks'][0].items()}, indent=2)}")
        await self.websocket.send(json.dumps(message))
        print("✅ Audio data sent successfully")
        logger.info("Sent audio data to Gemini")

    async def send_text(self, text: str):
        logger.info(f"[GeminiAudioService] Sending text: {text}")
        message = {
            "clientContent": {
                "turns": [
                    {
                        "role": "user",
                        "parts": [
                            {"text": text}
                        ]
                    }
                ],
                "turnComplete": True
            }
        }
        await self.websocket.send(json.dumps(message))
        logger.info("[GeminiAudioService] Text message sent.")

    async def receive_message(self):
        if not self.connected or not self.websocket:
            logger.warning("[GeminiAudioService] Tried to receive message but not connected.")
            return None
        try:
            message = await self.websocket.recv()
            logger.info(f"[GeminiAudioService] Received message from Gemini: {message[:200]}...")
            return json.loads(message)
        except Exception as e:
            logger.error(f"[GeminiAudioService] Error receiving message: {e}")
            self.connected = False
            return None
    async def close(self):
        if self.websocket:
            logger.info("[GeminiAudioService] Closing Gemini WebSocket.")
            await self.websocket.close()
        self.connected = False

class AudioConnectionManager:
    def __init__(self):
        self.active_connections: Dict[WebSocket, GeminiAudioService] = {}
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        logger.info(f"[AudioConnectionManager] New client connected: {id(websocket)}")
        gemini_client = GeminiAudioService()
        await gemini_client.connect()
        self.active_connections[websocket] = gemini_client
        asyncio.create_task(self.listen_to_gemini(websocket, gemini_client))
    async def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            logger.info(f"[AudioConnectionManager] Disconnecting client: {id(websocket)}")
            gemini_client = self.active_connections[websocket]
            await gemini_client.close()
            del self.active_connections[websocket]
    async def send_message(self, websocket: WebSocket, message: dict):
        try:
            logger.info(f"[AudioConnectionManager] Sending message to client: {message}")
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error(f"Error sending message to client: {e}")
    async def listen_to_gemini(self, websocket: WebSocket, gemini_client: GeminiAudioService):
        logger.info(f"[AudioConnectionManager] Listening to Gemini for client: {id(websocket)}")
        while gemini_client.connected:
            try:
                message = await gemini_client.receive_message()
                if message is None:
                    logger.info(f"[AudioConnectionManager] Gemini connection closed for client: {id(websocket)}")
                    break
                await self.process_gemini_message(websocket, message)
            except Exception as e:
                logger.error(f"Error in Gemini listener: {e}")
                break
    async def process_gemini_message(self, websocket: WebSocket, message: dict):
        try:
            logger.info(f"[AudioConnectionManager] Processing Gemini message: {str(message)[:200]}...")
            if "setupComplete" in message:
                await self.send_message(websocket, {"type": "info", "message": "Gemini setup complete"})
            elif "serverContent" in message:
                content = message["serverContent"]
                # Forward audio and transcript as before
                if "modelTurn" in content:
                    parts = content["modelTurn"].get("parts", [])
                    for part in parts:
                        if "inlineData" in part:
                            inline_data = part["inlineData"]
                            mime_type = inline_data.get("mimeType", "audio/pcm")
                            await self.send_message(websocket, {
                                "type": "audio",
                                "audio_data": inline_data.get("data", ""),
                                "mime_type": mime_type
                            })
                        elif "text" in part:
                            await self.send_message(websocket, {
                                "type": "transcript",
                                "text": part["text"]
                            })
                # Forward output transcription
                if "outputTranscription" in content:
                    await self.send_message(websocket, {
                        "type": "output_transcription",
                        "text": content["outputTranscription"].get("text", "")
                    })
                # Forward input transcription
                if "inputTranscription" in content:
                    await self.send_message(websocket, {
                        "type": "input_transcription",
                        "text": content["inputTranscription"].get("text", "")
                    })
                # Handle generationComplete and turnComplete
                if content.get("generationComplete"):
                    await self.send_message(websocket, {"type": "info", "message": "generationComplete"})
                if content.get("turnComplete"):
                    await self.send_message(websocket, {"type": "turnComplete"})
            elif "toolCall" in message:
                tool_call = message["toolCall"]
                await self.send_message(websocket, {"type": "info", "message": f"Tool call: {tool_call}"})
            elif "interrupted" in message:
                await self.send_message(websocket, {"type": "info", "message": "Conversation interrupted"})
            elif "realtimeInput" in message:
                realtime_input = message["realtimeInput"]
                if "userTranscript" in realtime_input:
                    await self.send_message(websocket, {"type": "user_transcript", "text": realtime_input["userTranscript"]})
            elif "error" in message:
                error = message["error"]
                await self.send_message(websocket, {"type": "error", "message": f"Gemini error: {error.get('message', 'Unknown error')}"})
            elif "goAway" in message:
                go_away = message["goAway"]
                await self.send_message(websocket, {"type": "info", "message": f"Session ending in {go_away.get('timeLeft', 'unknown')} seconds"})
            else:
                logger.info(f"Unknown message type from Gemini: {message}")
        except Exception as e:
            logger.error(f"Error processing Gemini message: {e}")
            await self.send_message(websocket, {"type": "error", "message": f"Error processing response: {str(e)}"})
