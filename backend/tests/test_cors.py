"""CORS guards.

The dev loop goes through Vite's `/api` proxy, so these headers are not on
the normal request path. They are the fallback for a developer who points
the frontend straight at the backend origin — and the fallback is only
useful if it stays correct while nothing exercises it day to day.
"""

import pytest
from pydantic import ValidationError

from core.config import (
    DEFAULT_BACKEND_PORT,
    DEFAULT_FRONTEND_PORT,
    Settings,
    settings,
)

ALLOWED_ORIGINS = settings.cors_origins
DISALLOWED_ORIGIN = "http://evil.example.com"

ORIGIN_ENV_VARS = ("LEARN_NODES_CORS_ORIGINS", "CORS_ORIGINS")


@pytest.fixture
def unconfigured_env(monkeypatch):
    """Clear any ambient overrides so the *default* path is what is tested."""

    for name in (*ORIGIN_ENV_VARS, "LEARN_NODES_FRONTEND_PORT"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
async def test_allowed_origin_receives_permission_header(async_client, origin):
    response = await async_client.get("/health", headers={"Origin": origin})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


async def test_disallowed_origin_receives_no_permission_header(async_client):
    response = await async_client.get("/health", headers={"Origin": DISALLOWED_ORIGIN})

    # Starlette still serves the response; the browser is what enforces the
    # refusal, and it does so by the absence of this header.
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("origin", [*ALLOWED_ORIGINS, DISALLOWED_ORIGIN, None])
async def test_no_response_advertises_credentials(async_client, origin):
    headers = {} if origin is None else {"Origin": origin}
    response = await async_client.get("/health", headers=headers)

    assert "access-control-allow-credentials" not in response.headers


async def test_preflight_from_allowed_origin_is_approved(async_client):
    response = await async_client.options(
        "/health",
        headers={
            "Origin": ALLOWED_ORIGINS[0],
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGINS[0]
    assert "GET" in response.headers["access-control-allow-methods"]
    assert "access-control-allow-credentials" not in response.headers


async def test_preflight_from_disallowed_origin_is_refused(async_client):
    response = await async_client.options(
        "/health",
        headers={
            "Origin": DISALLOWED_ORIGIN,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_default_allowlist_tracks_the_allocated_frontend_port(unconfigured_env):
    """The allowlist must follow the allocator, not a literal port.

    `5177` is only a preference — a taken port makes the allocator move on,
    and a stale hardcoded origin would leave the direct-access fallback
    pointing at a port nobody is serving.
    """

    unconfigured_env.setenv("LEARN_NODES_FRONTEND_PORT", "5301")

    assert Settings().cors_origins == (
        "http://localhost:5301",
        "http://127.0.0.1:5301",
    )


def test_default_allowlist_falls_back_when_no_port_is_exported(unconfigured_env):
    assert Settings().cors_origins == (
        f"http://localhost:{DEFAULT_FRONTEND_PORT}",
        f"http://127.0.0.1:{DEFAULT_FRONTEND_PORT}",
    )


def test_origins_are_configurable_from_the_environment(monkeypatch):
    monkeypatch.setenv(
        "LEARN_NODES_CORS_ORIGINS",
        "http://localhost:4000, http://127.0.0.1:4000",
    )

    assert Settings().cors_origins == (
        "http://localhost:4000",
        "http://127.0.0.1:4000",
    )


@pytest.mark.parametrize("wildcard", ["*", "http://*.localhost:5177"])
def test_wildcard_origin_is_rejected(monkeypatch, wildcard):
    monkeypatch.setenv("LEARN_NODES_CORS_ORIGINS", wildcard)

    with pytest.raises(ValidationError, match="never a wildcard"):
        Settings()


def test_backend_port_defaults_to_the_allocated_default(monkeypatch):
    monkeypatch.delenv("LEARN_NODES_BACKEND_PORT", raising=False)

    assert Settings().port == DEFAULT_BACKEND_PORT


def test_backend_port_follows_the_allocator(monkeypatch):
    monkeypatch.setenv("LEARN_NODES_BACKEND_PORT", "8042")

    assert Settings().port == 8042


def test_bare_port_env_var_is_ignored(monkeypatch):
    """A stray `PORT` must not move the port the proxy was told to target."""

    monkeypatch.delenv("LEARN_NODES_BACKEND_PORT", raising=False)
    monkeypatch.setenv("PORT", "9999")

    assert Settings().port == DEFAULT_BACKEND_PORT
