"""The agents and chat routes: scoped by account, streamed as SSE."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from api.dependencies.agents import get_launcher, get_turn_service
from api.dependencies.auth import get_profile_service
from api.routes.agents import router as agents_router
from api.routes.chat import router as chat_router
from core.secrets import InMemorySecretStore
from main import create_app
from service.agent.contract import TextChunk
from service.agent.sessions import TurnService
from service.identity.protocol import Identity
from service.profile_service import ProfileService
from tests.agent_doubles import FakeAgent, launcher_for

ADA = Identity(provider="dev", subject="ada", display_name="Ada")
GRACE = Identity(provider="dev", subject="grace", display_name="Grace")


@asynccontextmanager
async def client_for(
    data_dir: Path, store: InMemorySecretStore, agent: FakeAgent | None = None, *, fail: bool = False
) -> AsyncIterator[AsyncClient]:
    app = create_app(data_dir)
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    app.dependency_overrides[get_launcher] = lambda: launcher_for(agent or FakeAgent(), fail=fail)
    fake = agent or FakeAgent()

    async def provide(profile_id, registration):
        return fake

    turns = TurnService(data_dir, provide)
    app.dependency_overrides[get_turn_service] = lambda: turns
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


def _events(body: str) -> list[tuple[str, dict]]:
    events = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def _requests(router) -> list[tuple[str, str]]:
    requests = []
    for route in router.routes:
        assert isinstance(route, APIRoute)
        path = route.path.format(**{name: "unused" for name in route.param_convertors})
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            requests.append((method, path))
    return requests


@pytest.mark.parametrize(("method", "path"), _requests(agents_router) + _requests(chat_router))
async def test_every_agent_and_chat_route_refuses_while_signed_out(method, path, tmp_path):
    async with client_for(tmp_path, InMemorySecretStore()) as client:
        response = await client.request(method, path, json={})
    assert response.status_code == 401, f"{method} {path}"


async def test_register_list_default_and_remove(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        codex = (await client.post("/agents", json={"name": "Codex", "command": "codex-acp"})).json()
        claude = (await client.post("/agents", json={"name": "Claude", "command": "claude-acp"})).json()
        await client.put(f"/agents/{claude['id']}/default")
        listing = (await client.get("/agents")).json()
        removed = await client.delete(f"/agents/{codex['id']}")
        after = (await client.get("/agents")).json()

    assert codex["isDefault"] is True
    assert [(a["name"], a["isDefault"]) for a in listing["agents"]] == [("Codex", False), ("Claude", True)]
    assert {p["key"] for p in listing["presets"]} == {"codex", "claude"}
    assert removed.status_code == 204
    assert [a["name"] for a in after["agents"]] == ["Claude"]


async def test_a_command_that_will_not_launch_is_refused_with_its_stage(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store, fail=True) as client:
        ProfileService(store).enroll(ADA)
        response = await client.post("/agents", json={"name": "Typo", "command": "codx"})

    assert response.status_code == 422
    assert response.json()["detail"]["stage"] == "launch"


async def test_another_accounts_agent_is_answered_as_missing(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        service = ProfileService(store)
        service.enroll(GRACE)
        graces = (await client.post("/agents", json={"name": "Codex", "command": "x"})).json()
        service.enroll(ADA)
        answers = [
            (await client.post(f"/agents/{graces['id']}/test")).status_code,
            (await client.put(f"/agents/{graces['id']}/default")).status_code,
            (await client.delete(f"/agents/{graces['id']}")).status_code,
            (await client.post(f"/agents/{'no-such-agent'}/test")).status_code,
        ]
        listing = (await client.get("/agents")).json()

    assert answers == [404, 404, 404, 404]
    assert listing["agents"] == []


async def test_a_turn_streams_as_server_sent_events(tmp_path):
    store = InMemorySecretStore()
    agent = FakeAgent(script=lambda s, t: [TextChunk("po"), TextChunk("ng")])
    async with client_for(tmp_path, store, agent) as client:
        ProfileService(store).enroll(ADA)
        await client.post("/agents", json={"name": "Codex", "command": "x"})
        graph = (await client.post("/workspace/nodes", json={"title": "N"})).json()["graph"]
        thread = graph["threads"][-1]["id"]
        response = await client.post("/chat/turn", json={"threadId": thread, "text": "ping"})
        bootstrap = (await client.get("/workspace/bootstrap")).json()

    assert response.headers["content-type"].startswith("text/event-stream")
    events = _events(response.text)
    assert [name for name, _ in events] == ["turn.started", "text", "text", "turn.ended"]
    reply = next(m for m in bootstrap["graph"]["messages"] if m["id"] == events[0][1]["agentMessageId"])
    assert (reply["content"], reply["outcome"], reply["kind"]) == ("pong", "completed", "message")
    assert bootstrap["graph"]["nodes"][-1]["backendAgentId"] is not None


async def test_a_turn_on_another_accounts_thread_is_404_not_a_stream(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        service = ProfileService(store)
        service.enroll(GRACE)
        graph = (await client.post("/workspace/nodes", json={"title": "Grace's"})).json()["graph"]
        thread = graph["threads"][-1]["id"]
        service.enroll(ADA)
        response = await client.post("/chat/turn", json={"threadId": thread, "text": "hi"})

    assert response.status_code == 404


async def test_cancelling_an_ended_turn_is_not_an_error(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        response = await client.post("/chat/turns/finished-long-ago/cancel")
    assert response.status_code == 204


async def test_a_node_cannot_be_pointed_at_another_accounts_agent(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        service = ProfileService(store)
        service.enroll(GRACE)
        graces = (await client.post("/agents", json={"name": "Codex", "command": "x"})).json()
        service.enroll(ADA)
        own = (await client.post("/agents", json={"name": "Mine", "command": "x"})).json()
        node = (await client.post("/workspace/nodes", json={"title": "N"})).json()["graph"]["nodes"][-1]
        refused = await client.put(f"/workspace/nodes/{node['id']}/backend", json={"agentId": graces["id"]})
        accepted = await client.put(f"/workspace/nodes/{node['id']}/backend", json={"agentId": own["id"]})

    assert refused.status_code == 404
    assert accepted.json()["graph"]["nodes"][-1]["backendAgentId"] == own["id"]


async def test_removing_an_agent_keeps_its_conversations_readable(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        agent = (await client.post("/agents", json={"name": "Codex", "command": "x"})).json()
        graph = (await client.post("/workspace/nodes", json={"title": "N"})).json()["graph"]
        await client.post("/chat/turn", json={"threadId": graph["threads"][-1]["id"], "text": "hi"})
        await client.delete(f"/agents/{agent['id']}")
        messages = (await client.get("/workspace/bootstrap")).json()["graph"]["messages"]

    assert [(m["role"], m["content"]) for m in messages] == [("learner", "hi"), ("agent", "pong")]


async def test_a_command_is_accepted_and_its_result_is_in_bootstrap(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        await client.post("/agents", json={"name": "Codex", "command": "x"})
        graph = (await client.post("/workspace/nodes", json={"title": "N"})).json()["graph"]
        thread = graph["threads"][-1]["id"]
        unknown = await client.post("/chat/turn", json={"threadId": thread, "text": "/x hi", "command": "essay"})
        response = await client.post("/chat/turn", json={"threadId": thread, "text": "/quiz folds", "command": "quiz"})
        messages = (await client.get("/workspace/bootstrap")).json()["graph"]["messages"]

    assert unknown.status_code == 422
    assert response.status_code == 200
    assert messages[0]["content"] == "/quiz folds" and messages[0]["data"] is None
    notice = next(m for m in messages if m["kind"] == "practice_not_delivered")
    assert notice["data"] == {"tool": "quiz"}
