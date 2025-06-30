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
        self.api_key = 'ya29.c.c0ASRK0GYAb0TtyjeDpgd32Jvik1NUKa6BbE0hstWasWct9b3oKFE3075qYfk_8kROuTu8c6u_MtTMqsNJ2Ap74j2TBFb4nlUZu_ysarv9gikpJ62HNXybiLJAtQddU3EXWufKohk20HY4zmRW3Mb6OfUDl8T3XVEbO50o-g_eMWvzEdafGc37YDP6njpRrplOkQ6aSZYB9weSzC-leT_ez9siOk3c1w4b4hhWSMAFZC5MiD9--Zo_POjHiACX6bWu-yFq5DxxCnbsoqTktfboHTYG0BtqkOTGCpUH5zl42Z3k8VxprFwCWuKiwsSPDRWG3yHqtl0W9Cyv5JZahiT27CaOKJs-D5FU9yHZBfogVsCV7go6kKGbf-pbegL387Kk74Rk0W9OkFc-uMgcj8lxpzqgwptx1-jfWFaxX_JIh9jR1IUMSXWBawVztIdZxShe-BVoxa8-jQeo6aisXYoZZgrcx524Oi7snV0IFgalh9Qr6OQxwFBnma22xnoaynby14U4jrWf-ZmJbmUjjri_hW4ZlQ_Jl9o4r_I355spoYaM-yRcnc57dXQB8qgyOX_p7UMQ9hn9wJldqFmhSosx311g-jO4jue94e1a0hFMS7VxiBbb2xQxV3g64xnf3W7BZue9lgXukWUjo76SZbFV11i4r6ZudelRvzV2vome9Or2OWsexqc39Rl_r1Ih7aBrwihn4ftQr5hwoBQwQ6Zjs2U4co9x-_gmV2J70w5WjO1o6QmgJx_82jZ69WWyuaQng9we4WuqJu0wBrbYh-uMcSh363vtYzvc5sv4fMoOa7tItjVk-wxo16bwiyIJjz65r2tJVFasS49JV1_YSd2m3Mn38qjadp5j8YSU8Rg6gbMZR63Vc92VU8xSW27j2v6ivzl975dfhUZFa7__8h-cJy-YaYdtBVr0k_JqFUZuWnBtzqF8reyudWZhkzQ0w4zdx-Mc8tI-fFFVXnat0bJIQsjn1Ba4-7on5Y44_oFfJk9J2q3zptoS07i'
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

    async def send_setup(self, config: Dict[str, Any]):
        logger.info(f"[GeminiAudioService] Sending setup: {config}")
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
                    "parts": [{ "text": "You are a helpful assistant." }]
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
