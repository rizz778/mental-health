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