"""ASGI entry point.

Kept deliberately thin: app construction, middleware, and router mounting only.
`main:app` remains the import path used by uvicorn and by backend/tests/conftest.py.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import health
from core.config import settings

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
