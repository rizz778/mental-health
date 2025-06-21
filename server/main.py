from fastapi import FastAPI, Request,WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from contextlib import asynccontextmanager
import uuid
import structlog
import os
import logging
import asyncio


from datetime import datetime, date
from core.config import settings
from core.logging import setup_logging, get_logger
from core.exceptions import AppException
from core.handlers import app_exception_handler, validation_exception_handler, generic_exception_handler
from starlette.middleware.trustedhost import TrustedHostMiddleware
from api.deps import initialize_dependencies
from api.ws.router import router as ws_router
from services.gemini_service import GeminiService
# from services.emotion_service import EmotionService  # NEW IMPORT
from services.audio_service import AudioService


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger = get_logger(__name__)

    try:
        await initialize_dependencies()
        logger.info("Dependencies initialized successfully")
        yield
    
    except Exception as e:
        logger.error(f"Failed to start application: {str(e)}")
        raise

class CustomJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        from server.core.json import custom_jsonable_encoder
        return super().render(custom_jsonable_encoder(content))

app = FastAPI(
    title="Mental System Backend",
    description="Backend API for Eduviva",
    version="1.0.0",
    lifespan=lifespan,
    default_response_class=CustomJSONResponse
)

# Exception Handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(ValidationError, validation_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

app.include_router(ws_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# # WebSocket entrypoint
# logging.basicConfig(level=logging.INFO)
# logger = logging.getLogger(__name__)


    

# gemini_service = GeminiService(settings.GEMINI_API_KEY,settings.GEMINI_MODEL)
# audio_service=AudioService(settings.GEMINI_API_KEY,settings.GEMINI_MODEL)
# # emotion_service = EmotionService()  # Instantiate EmotionService
# active_sessions = {}
# ws_handler = WebSocketHandler(gemini_service,audio_service,active_sessions)  # UPDATED

# host = "localhost"
# port = 8765
# logger.info(f"Starting WebSocket server on {host}:{port}")

# server = await websockets.serve(
#         ws_handler.handle_client_connection,
#         host,
#         port,
#         ping_interval=20,
#         ping_timeout=10
#     )

# logger.info("WebSocket server started successfully")
# logger.info("Waiting for client connections...")
# await asyncio.Future()  # Keep server running

app.include_router
@app.get("/health")
async def health_check():
    return {"status": "healthy"}
