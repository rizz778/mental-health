import asyncio
import json
import logging
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

class GeminiService:
    def __init__(self, api_key, model="gemini-2.0-flash-live-001"):
        self.client = genai.Client(api_key=api_key)
        self.model = model

    async def start_session(self, config):
        session_cm = self.client.aio.live.connect(model=self.model, config=config)
        session = await session_cm.__aenter__()
        return session, session_cm

    
    async def send_client_content(self, session, turns, turn_complete=True):
        gemini_turns = [
            types.Content(
                role=turn.get("role", "user"),
                parts=[types.Part(**part) for part in turn.get("parts", [])]
            )
            for turn in turns
        ]
        await session.send_client_content(turns=gemini_turns, turn_complete=turn_complete)

    
    
    async def receive_responses(self, session, websocket, client_id, active_sessions):
        try:
            async for response in session.receive():
                logger.info(f"[Gemini] Raw response for {client_id}: {response}")
                # Forward relevant fields to websocket
                if hasattr(response, "session_resumption_update") and response.session_resumption_update:
                    handle = response.session_resumption_update.new_handle
                    resumable = response.session_resumption_update.resumable
                    active_sessions[client_id]["session_handle"] = handle
                    await websocket.send(json.dumps({
                        "type": "session_resumption_update",
                        "handle": handle,
                        "resumable": resumable
                    }))
                if getattr(response, "text", None) is not None:
                    await websocket.send(json.dumps({
                        "type": "text_chunk",
                        "content": response.text,
                        "complete": False
                    }))
                if getattr(response, "server_content", None):
                    if response.server_content.generation_complete:
                        await websocket.send(json.dumps({
                            "type": "generation_complete",
                            "message": "Response generation completed"
                        }))
                    if response.server_content.interrupted:
                        await websocket.send(json.dumps({
                            "type": "interrupted",
                            "message": "Generation was interrupted"
                        }))
                if hasattr(response, 'tool_call') and response.tool_call:
                    await websocket.send(json.dumps({
                        "type": "tool_call",
                        "tool_call": str(response.tool_call)
                    }))
                if getattr(response, "usage_metadata", None):
                    usage = response.usage_metadata
                    await websocket.send(json.dumps({
                        "type": "usage_update",
                        "total_tokens": usage.total_token_count,
                        "details": [
                            {
                                "modality": getattr(detail, 'modality', 'unknown'),
                                "token_count": getattr(detail, 'token_count', 0)
                            }
                            for detail in getattr(usage, 'response_tokens_details', [])
                        ]
                    }))
                if hasattr(response, 'go_away') and response.go_away:
                    await websocket.send(json.dumps({
                        "type": "session_warning",
                        "message": f"Session ending in: {getattr(response.go_away, 'time_left', None)}",
                        "go_away": str(response.go_away)
                    }))
        except Exception as e:
            logger.error(f"[Gemini] Error listening to Live API for {client_id}: {e}")
            if websocket.close_code is None:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Live API error: {str(e)}"
                }))
