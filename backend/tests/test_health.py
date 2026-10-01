import pytest

from core.config import settings

# Derived, not literal: the frontend port is allocated per dev session, so
# pinning it here would re-break every time the default is taken.
CORS_ORIGINS = settings.cors_origins


@pytest.mark.asyncio
@pytest.mark.parametrize("origin", CORS_ORIGINS)
async def test_health_endpoint(async_client, origin):
    response = await async_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "backend": "fastapi"}


@pytest.mark.asyncio
@pytest.mark.parametrize("origin", CORS_ORIGINS)
async def test_cors_allows_tauri_loopback_origins(async_client, origin):
    """Regression guard for the CORS allow-list.

    A developer bypassing the Vite proxy reaches FastAPI via either
    `127.0.0.1` or `localhost`; if either origin is dropped, the status
    indicator shows a red dot even when the backend is healthy. Broader
    coverage lives in `test_cors.py`.
    """

    response = await async_client.get("/health", headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.json() == {"status": "ok", "backend": "fastapi"}