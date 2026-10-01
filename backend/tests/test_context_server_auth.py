"""The context server admits only live credentials, from the device, not browsers."""

from __future__ import annotations

import socket

import httpx
import pytest

from main import create_app
from service.context_server.app import ContextServer
from service.context_server.credentials import CredentialRegistry, Scope

SCOPE = Scope("profile", "workspace", "node", "thread", "agent", "Codex")
LIST = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
HEADERS = {"accept": "application/json, text/event-stream"}


@pytest.fixture
async def server():
    context = ContextServer()
    await context.start()
    yield context
    await context.stop()


async def _post(url: str, token: str | None = None, **headers) -> httpx.Response:
    auth = {"authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient() as client:
        return await client.post(url, json=LIST, headers={**HEADERS, **auth, **headers})


async def test_a_live_credential_is_admitted(server):
    token = server.credentials.mint(SCOPE)
    response = await _post(server.url, token)
    assert response.status_code == 200
    assert "tools" in response.json()["result"]


@pytest.mark.parametrize("token", [None, "made-up-token"])
async def test_no_or_unknown_credential_is_refused_with_no_data(server, token):
    response = await _post(server.url, token)
    assert response.status_code == 401
    assert "tools" not in response.text


async def test_a_credential_from_before_a_restart_is_refused(server):
    old_token = CredentialRegistry().mint(SCOPE)  # a previous process's registry
    assert (await _post(server.url, old_token)).status_code == 401


async def test_a_browser_origin_is_refused_even_with_a_credential(server):
    token = server.credentials.mint(SCOPE)
    response = await _post(server.url, token, origin="http://localhost:5177")
    assert response.status_code == 403


def test_reminting_for_the_same_session_revokes_the_previous_credential():
    registry = CredentialRegistry()
    first = registry.mint(SCOPE)
    second = registry.mint(SCOPE)
    assert registry.resolve(first) is None
    assert registry.resolve(second) == SCOPE
    assert registry.token_for("thread", "agent") == second


async def test_it_listens_on_loopback_only(server):
    host, port = server._server.servers[0].sockets[0].getsockname()[:2]
    assert host == "127.0.0.1" and port == server.port


async def test_it_starts_and_stops_with_the_application(tmp_path):
    app = create_app(tmp_path, context_server=True)
    async with app.router.lifespan_context(app):
        port = app.state.runtime.context.port
        assert port
    probe = socket.socket()
    probe.bind(("127.0.0.1", port))  # free again: the listener is gone
    probe.close()


async def test_the_suite_can_leave_it_off(tmp_path):
    app = create_app(tmp_path, context_server=False)
    async with app.router.lifespan_context(app):
        assert app.state.runtime.context is None
