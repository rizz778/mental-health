<<<<<<< HEAD
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
            "to 10 (extreme distress). Only return a single number between 0 and 10, with no explanation or text.\n\n"
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
            match = re.search(r"\b([0-9](?:\.\d+)?|10(?:\.0+)?)\b", response.text)
            if match:
                score = float(match.group(1))
                score = max(0.0, min(10.0, score))  # Clamp to 0-10
                return score
            else:
                logger.error(f"[DistressScoreService] No valid score found in Gemini response: {response.text}")
                return None
        except Exception as e:
            logger.error(f"[DistressScoreService] Error calculating distress score: {e}")
            return None
=======
import os
import google.generativeai as genai
import re
import json

GEMINI_API_KEY = 'AIzaSyA7305RGIlw82ON0bC994O_YHh4Kklc_aI'

# Configure Gemini API
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)



def llm_distress_score(text: str) -> float:
    """
    Uses Gemini 1.5 Flash to analyze the user's input and returns a distress score (0-10).
    """
    prompt = f"""
You are a mental health assessment assistant.

Assign a distress score from 0 to 10 based on the emotional intensity and language of the message:
- 0 means emotionally stable and calm.
- 10 means extremely distressed, at risk of harm, or needing immediate help.

Respond only with a number between 0 and 10.

User Input: "{text}"
"""
    try:
        model = genai.GenerativeModel('models/gemini-1.5-flash')
        response = model.generate_content(prompt)
        raw_text = response.text.strip()
        # Extract the first number between 0 and 10
        match = re.search(r'([0-9]+(?:\.[0-9]+)?)', raw_text)
        if match:
            score = float(match.group(1))
            score = max(0, min(10, score))
            return score
        else:
            return 0.0
    except Exception as e:
        return 0.0
>>>>>>> audio-part
