import pytest

CORS_ORIGINS = (
    "http://localhost:1420",
    "http://127.0.0.1:1420",
)


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

    The bundled Tauri webview reaches FastAPI via either `127.0.0.1` or
    `localhost`; if either origin is dropped, the placeholder UI shows a
    red dot even when the backend is healthy.
    """

    response = await async_client.get("/health", headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.json() == {"status": "ok", "backend": "fastapi"}