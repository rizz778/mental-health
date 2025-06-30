import logging
import google.generativeai as genai

logger = logging.getLogger(__name__)

class DistressScoreService:
    def __init__(self, api_key, model="gemini-2.0-flash"):
    
        genai.configure(api_key=api_key)
        self.model_name = model
        self.model = genai.GenerativeModel(model)
        print("DISTRESS_API_KEY:", api_key)
    async def calculate_distress_score(self, messages):
        conversation = "\n".join([f"User: {m['content']}" for m in messages if m['type'] == "user"])
        prompt = (
            "Given the following conversation, rate the user's psychological distress on a scale from 0 (no distress) "
            "to 1 (extreme distress). Only return a single number between 0 and 1, with no explanation or text.\n\n"
            f"{conversation}\n\nDistress score:"
        )
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self.model.generate_content(
                    prompt,
                    generation_config={
                        "temperature": 0.2,
                        "max_output_tokens": 5,
                    }
                )
            )
            logger.info(f"[DistressScoreService] Gemini response: {response.text}")
            import re
            match = re.search(r"([01](?:\.\d+)?)", response.text)
            if match:
                score = float(match.group(1))
                score = max(0.0, min(1.0, score))
                return score
            else:
                logger.error(f"[DistressScoreService] No valid score found in Gemini response: {response.text}")
                return None
        except Exception as e:
            logger.error(f"[DistressScoreService] Error calculating distress score: {e}")
            return None