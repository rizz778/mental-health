from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from contextlib import asynccontextmanager
import uuid
import structlog
from datetime import datetime, date
from datetime import datetime, date
from server.core.config import settings
from server.core.database import database
from server.core.logging import setup_logging, get_logger
from server.core.exceptions import AppException
from server.core.handlers import app_exception_handler, validation_exception_handler, generic_exception_handler
from starlette.middleware.trustedhost import TrustedHostMiddleware


@asynccontextmanager
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    setup_logging()
    logger = get_logger(__name__)
    
    
    
    # Shutdown
    database.disconnect()
    logger.info("Application shutdown complete")

class CustomJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        # Use our custom encoder for all responses
        from server.core.json import custom_jsonable_encoder
        return super().render(custom_jsonable_encoder(content))

app = FastAPI(
    title="Eduviva Backend",
    description="Backend API for Eduviva",
    version="1.0.0",
    lifespan=lifespan,
    default_response_class=CustomJSONResponse  # Use our custom response class for all endpoints
)

# Register exception handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(ValidationError, validation_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])

print(settings)

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

app.include_router
@app.get("/health")
async def health_check():
    return {"status": "healthy"}