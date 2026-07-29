"""Health check route.

Returns a static payload, so per the layering rules it has no service or
repository behind it — the route is the whole implementation.
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "backend": "fastapi"}
