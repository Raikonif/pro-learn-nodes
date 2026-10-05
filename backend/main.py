"""ASGI entry point.

Kept deliberately thin: app construction, middleware, and router mounting only.
`main:app` remains the import path used by uvicorn and by backend/tests/conftest.py.
"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import agents, auth, chat, health, memory, permissions, practice, workspace
from core.config import settings
from core.runtime import RuntimeState, local_data_lifespan


def create_app(data_dir: Path | None = None, *, context_server: bool | None = None) -> FastAPI:
    """Create an app whose durable data lifecycle is explicit and testable.

    `context_server` decides whether the lifespan starts the agents' MCP
    listener. Unset, it is on unless `LEARN_NODES_CONTEXT_SERVER=0` — which
    the test suite sets so the hundreds of apps it builds do not each start
    and stop a listener they never use.
    """

    app = FastAPI(title=settings.app_name, lifespan=local_data_lifespan)
    app.state.data_dir = data_dir or settings.data_dir
    if context_server is None:
        context_server = os.environ.get("LEARN_NODES_CONTEXT_SERVER", "1") != "0"
    app.state.context_server_enabled = context_server
    app.state.runtime = RuntimeState()

# BREAKING: credentialed cross-origin requests are off. Nothing here uses
# cookies — BYOK provider keys travel in headers — and leaving the flag on
# is exactly what forbids any pattern-based origin fallback in a browser.
# A future cookie-backed session must turn this back on deliberately, and
# narrow `allow_origins` at the same time.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    # Built per app rather than imported as a ready-made router: which sign-in
    # routes exist depends on the development gate, and that is decided when
    # the app is constructed, not when the module is first imported.
    app.include_router(auth.create_router())
    app.include_router(workspace.router)
    app.include_router(agents.router)
    app.include_router(chat.router)
    app.include_router(practice.router)
    app.include_router(memory.router)
    app.include_router(permissions.router)
    return app


app = create_app()
