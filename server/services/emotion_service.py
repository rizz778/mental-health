import cv2
import numpy as np
from collections import deque, Counter
from typing import Deque, Dict
import logging
from deepface import DeepFace  # Or your preferred model

logger = logging.getLogger(__name__)

class EmotionService:
    def __init__(self, buffer_size: int = 10):
        self.buffer: Deque[str] = deque(maxlen=buffer_size)

    def analyze_frame(self, frame: np.ndarray) -> str:
        try:
            result = DeepFace.analyze(frame, actions=["emotion"], enforce_detection=False)
            emotion = result[0]["dominant_emotion"]
            self.buffer.append(emotion)
            return emotion
        except Exception as e:
            logger.warning(f"Emotion analysis failed: {e}")
            return "unknown"

    def get_aggregated_emotion(self) -> str:
        if not self.buffer:
            return "neutral"
        most_common = Counter(self.buffer).most_common(1)
        return most_common[0][0]
