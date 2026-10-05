"""Health check route.

Returns a static payload, so per the layering rules it has no service or
repository behind it — the route is the whole implementation.

The Pydantic response model enforces the wire contract
(`{"status": "ok", "backend": "fastapi"}`) on the server side and emits
the exact same JSON shape the frontend's `HealthSchema` (Zod) validates
against. Adding the typed model is a strict improvement over the prior
`dict[str, str]` return — it produces an OpenAPI schema for the route,
catches accidental field drift at definition time, and matches the
FastAPI skill's "Return Type or Response Model" guidance.

The `Annotated[..., Depends(...)]` pattern is established here so Phase 2+
routes have a reference for declaring shared dependencies (e.g. request
ids, database sessions) without re-introducing the legacy
`Depends(get_thing)` positional style.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel


class Health(BaseModel):
    status: Literal["ok"]
    backend: Literal["fastapi"]


class DataHealth(BaseModel):
    status: Literal["pending", "ok", "missing", "damaged"]
    detail: str | None = None


class Readiness(BaseModel):
    status: Literal["ready"]
    backend: Literal["fastapi"]
    data: DataHealth


def get_request_id() -> str:
    """No-op dependency placeholder.

    Phase 2+ will return the upstream `X-Request-ID` header (or generate
    one). Declaring it here via `Annotated[..., Depends(...)]` keeps the
    router free of legacy `Depends(...)` positional arguments and gives
    later routes a ready-made template.
    """

    return "phase-1"


RequestIdDep = Annotated[str, Depends(get_request_id)]


router = APIRouter(tags=["health"])


@router.get("/health")
async def health(_request_id: RequestIdDep) -> Health:
    return Health(status="ok", backend="fastapi")


@router.get("/ready")
async def ready(request: Request, _request_id: RequestIdDep) -> Readiness:
    runtime = request.app.state.runtime
    data = DataHealth(status=runtime.data.status.value, detail=runtime.data.detail)
    if not runtime.ready:
        # The desktop shell reads `data.status` to decide whether to keep
        # waiting (`pending`) or restore from another copy (`missing`, `damaged`).
        message = runtime.error or "Local data initialization is still pending"
        raise HTTPException(status_code=503, detail={"message": message, "data": data.model_dump()})
    return Readiness(status="ready", backend="fastapi", data=data)
