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
        # Enable context window compression with a sliding window
        from google.genai import types
        # If config is a dict, build a LiveConnectConfig object
        if isinstance(config, dict):
            config = types.LiveConnectConfig(
                **{k: v for k, v in config.items() if k != 'context_window_compression'},
                context_window_compression=types.ContextWindowCompressionConfig(
                    sliding_window=types.SlidingWindow()
                )
            )
        else:
            config.context_window_compression = types.ContextWindowCompressionConfig(
                sliding_window=types.SlidingWindow()
            )
        session_cm = self.client.aio.live.connect(model=self.model, config=config)
        session = await session_cm.__aenter__()
        return session, session_cm

    
    async def send_client_content(self, session, turns, turn_complete=True):
        # Send the full conversation history (multi-turn)
        if turns:
            print("[GeminiService] Sending to Gemini (raw dict, multi-turn):", turns, "turn_complete:", turn_complete)
            await session.send_client_content(turns=turns, turn_complete=turn_complete)
        else:
            # If no turns, do nothing or raise error
            pass

    
    
    async def receive_responses(self, session, websocket, client_id, active_sessions, api_key=None, config=None):
        """
        After every Gemini response, close and reconnect the Gemini session using the latest session handle (if available).
        This acts as a heartbeat/forced reconnect to ensure session continuity.
        """
        try:
            while True:
                async for response in session.receive():
                    # Print for all message types
                    if hasattr(response, "session_resumption_update") and response.session_resumption_update:
                        handle = response.session_resumption_update.new_handle
                        resumable = response.session_resumption_update.resumable
                        active_sessions[client_id]["session_handle"] = handle
                        await websocket.send(json.dumps({
                            "type": "session_resumption_update",
                            "handle": handle,
                            "resumable": resumable
                        }))
                    if getattr(response, "go_away", None):
                        print(f"[GeminiService] Received go_away for {client_id}: {response.go_away}")
                        session_handle = active_sessions[client_id].get("session_handle")
                        await websocket.send(json.dumps({
                            "type": "session_warning",
                            "message": f"Session ending in: {getattr(response.go_away, 'time_left', None)}",
                            "go_away": str(response.go_away),
                            "resume_handle": session_handle
                        }))
                    if getattr(response, "text", None) is not None:
                        print(f"[GeminiService] Received text for {client_id}: {response.text}")
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
                            # --- Forced reconnect/heartbeat logic removed ---
                            # Only reconnect if go_away or error occurs
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
        except Exception as e:
            logger.error(f"[Gemini] Error listening to Live API for {client_id}: {e}")
            if websocket.close_code is None:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Live API error: {str(e)}"
                }))
