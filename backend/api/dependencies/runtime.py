"""The ready gate every data route declares first.

A request that arrives before local data is open answers 503 instead of
asking an unconfigured engine anything. Declared before `WorkspaceScope` on
every route: FastAPI solves dependencies in declaration order, so the order
is what keeps a not-yet-migrated database from being asked who is signed in.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request

from core.runtime import RuntimeState

__all__ = ["RuntimeDep", "require_ready_runtime"]


def require_ready_runtime(request: Request) -> RuntimeState:
    runtime: RuntimeState = request.app.state.runtime
    if not runtime.ready:
        raise HTTPException(
            status_code=503,
            detail=runtime.error or "Local data is not ready",
        )
    return runtime


RuntimeDep = Annotated[RuntimeState, Depends(require_ready_runtime)]
