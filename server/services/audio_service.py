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
        self.api_key = 'ya29.c.c0ASRK0GZWKAvCtamzsBDxG4gZw971dHRoui5k8XoeQOzH-0p34rUKeBH-FJRB2xrtwHbMFfFRa1WW2yQoNxzlv1eOqogkcSWGCUOj_PASPxW8JlbWBmlElP2b4_4uHZ9kpqgNAEKMBpqRukY4VMH4kiRcg0P1tzQwKmYMgUQeeZxgV-agN110_ptea0kqCXH4AVmBSH7KtQNFv9SoLjteGSHtnKTmEQcoa8aokLAJ3wCC6wbNSHj-CuPsISTpE9NAX2rMi5WSiGV6Vk2gVXiNeFHPjCv78frSJwpb4H7hQDlgiEktoeXHbWAdeCwz5YlOvrEwsQSQnw5c7Nq2xG7iXW6XRyS0J3LpoaOkTK4A9PPOZre98IJorSBJ1yvCH389A5cFWq_qbIl9-_ZlWzse6svaVVcaJ8Wg44UuYWos4s3wnVUSs7qVhdMoy396Ox-QgY0dJ_BIU6_6YaRQkm6rtXvncfcFR2yXzlQnRsxszg_MlZ8YcjQkXp5p5X8XJq3cQghjWdpnys20ezBcou4ORFnnifXIUY7XecXpoFRR7dbrBQZQ4qqjVZUUtMapuwSrWfkMzfk1FX6Yhis2W8IfbZy5cwI9g36Fcivo9lcne61vqZgMskRo8frpBj_QpeF1V35_io0rMxY2qxb91_t3_VWa9jJVcWBo9p5eh7Zu1vrxQUiJdl7RjM9Y45WptQW1zYarkI0Q2nIiFS4qyp1u5whFlRxWf_Qojv7olmBaqSoVXlB7UaQickhpZx9tlXeRel0yczVJ6Ow4Sv3RZrUkcX8qYeky1e47Bs0Fg3wBYp-lcaUnpzbMQ7acIFxVsoooe9V0Rs2aUfFygc99lVsycwh5Vnk3Yto86_IU8UWufb5jy42xp8Y9Yu5BOZm7la_V1vFi5fqsp-aS2petieSOVpebQMJ_iQ0codw7--U8-jdhBykSMnMt9I4ua-tSO1li-mIuVBBv1fShFq1FsBw74h3ioW4WQFzYZm0_0bhJfciqVFMspcbFwJj'
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
                # VAD config removed: let Gemini handle VAD with defaults
                "systemInstruction": {
                    "parts": [{ "text": system_prompt }]
                },
                "tools": []
            }
        }
        await self.websocket.send(json.dumps(setup_message))
        logger.info("[GeminiAudioService] Setup message sent.")

    async def send_audio(self, audio_data: str, end_of_stream: bool = False):
        """Send audio data to Gemini using realtime input. Optionally signal end of stream."""
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
        
        msg_items = {k: (f'[{len(v)} chars]' if k == 'data' else v) for k, v in message['realtimeInput']['mediaChunks'][0].items()}
        print(f"\U0001F4E4 Audio message structure: {msg_items}")
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
