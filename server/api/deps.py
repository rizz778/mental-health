from services.gemini_service import GeminiService
from services.audio_service import AudioService
from services.distress_service import DistressScoreService
from services.emotion_service import EmotionService

from core.config import settings

class DependencyStorage:

    def __init__(self, api_key, gemini_model):
        self.api_key = api_key
        self.gemini_model = gemini_model

        self._gemini_service = GeminiService(api_key=api_key, model=gemini_model)
        self._audio_service = AudioService(api_key=api_key, model=gemini_model)
        self._emotion_service = EmotionService()  # <-- Singleton instance

    def get_distress_service(self) -> DistressScoreService:
        return DistressScoreService(api_key=settings.DISTRESS_API_KEY)

    def get_gemini_service(self) -> GeminiService:
        return self._gemini_service

    def get_audio_service(self) -> AudioService:
        return self._audio_service

    def get_emotion_service(self) -> EmotionService:
        return self._emotion_service  # <-- Always return the same instance

async def initialize_dependencies():
    global dependency_storage
    dependency_storage = DependencyStorage(api_key=settings.GEMINI_API_KEY, gemini_model=settings.GEMINI_MODEL)

def get_gemini_service() -> GeminiService:
    if dependency_storage is None:
        raise RuntimeError("Dependencies not initialized")
    return dependency_storage.get_gemini_service()

def get_audio_service() -> AudioService:
    if dependency_storage is None:
        raise RuntimeError("Dependencies not initialized")
    return dependency_storage.get_audio_service()

def get_distress_service() -> DistressScoreService:
    if dependency_storage is None:
        raise RuntimeError("Dependencies not initialized")
    return dependency_storage.get_distress_service()

def get_emotion_service() -> EmotionService:
    if dependency_storage is None:
        raise RuntimeError("Dependencies not initialized")
    return dependency_storage.get_emotion_service()