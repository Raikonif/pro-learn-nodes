"""The permission routes: answering a waiting request, and the decisions a learner kept.

A turn runs on the shared `TurnService` in a task while the routes are called
over HTTP — the stream and the decision route meeting in one registry, as
they do in the application.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from api.dependencies.agents import get_launcher, get_turn_service
from api.dependencies.auth import get_profile_service
from api.routes.permissions import router as permissions_router
from core.secrets import InMemorySecretStore
from main import create_app
from service.agent.contract import TextChunk
from service.agent.sessions import TurnService
from tests.agent_doubles import FakeAgent, asks, launcher_for
from tests.test_agent_routes import ADA, GRACE, _requests
from service import workspace
from service.profile_service import ProfileService


@asynccontextmanager
async def harness(data_dir: Path, store: InMemorySecretStore) -> AsyncIterator[tuple[AsyncClient, TurnService, FakeAgent]]:
    app = create_app(data_dir)
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    agent = FakeAgent(script=lambda s, t: [asks("edit", "Write notes.md"), TextChunk("done")])
    app.dependency_overrides[get_launcher] = lambda: launcher_for(agent)

    async def provide(profile_id, registration):
        return agent

    turns = TurnService(data_dir, provide)
    app.dependency_overrides[get_turn_service] = lambda: turns
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, turns, agent


async def _start_turn(client: AsyncClient, turns: TurnService, store, identity, title: str):
    """As `identity`: a node on an agent, and a turn waiting on its permission request."""

    profile = ProfileService(store).enroll(identity)
    await client.post("/agents", json={"name": "Codex", "command": "x"})
    graph = (await client.post("/workspace/nodes", json={"title": title})).json()["graph"]
    node = next(n["id"] for n in graph["nodes"] if n["title"] == title)
    thread = next(t["id"] for t in graph["threads"] if t["nodeId"] == node)
    workspace_id = workspace.ensure_default_workspace(profile.id).id
    asked = asyncio.Event()
    events: list = []

    async def run():
        async for name, data in turns.run_turn(profile.id, workspace_id, thread, "go"):
            events.append((name, data))
            if name == "permission.requested":
                asked.set()

    task = asyncio.create_task(run())
    waiting = asyncio.create_task(asked.wait())
    await asyncio.wait({task, waiting}, timeout=5, return_when=asyncio.FIRST_COMPLETED)
    waiting.cancel()
    assert asked.is_set(), f"the turn never asked: {events} {task.exception() if task.done() else ''}"
    return task, events


@pytest.mark.parametrize(("method", "path"), _requests(permissions_router))
async def test_every_permission_route_refuses_while_signed_out(method, path, tmp_path):
    async with harness(tmp_path, InMemorySecretStore()) as (client, _, _):
        response = await client.request(method, path, json={"allow": True})
    assert response.status_code == 401, f"{method} {path}"


async def test_a_waiting_request_is_listed_answered_once_and_the_turn_goes_on(tmp_path):
    store = InMemorySecretStore()
    async with harness(tmp_path, store) as (client, turns, agent):
        task, events = await _start_turn(client, turns, store, ADA, "Loops")

        pending = (await client.get("/permissions/pending")).json()
        assert [(p["title"], p["kind"], p["nodeTitle"], p["agentName"]) for p in pending] == [
            ("Write notes.md", "edit", "Loops", "Codex")
        ]
        request_id = pending[0]["requestId"]

        first = await client.post(f"/permissions/pending/{request_id}", json={"allow": True})
        second = await client.post(f"/permissions/pending/{request_id}", json={"allow": False})
        await asyncio.wait_for(task, 5)

        assert (first.status_code, second.status_code) == (204, 409)
        assert agent.answers == [("Write notes.md", "allow")]
        assert ("permission.decided", {"requestId": request_id, "messageId": events[-3][1]["messageId"],
                                       "allow": True, "remembered": False}) in events
        assert events[-1][1]["outcome"] == "completed"
        assert (await client.get("/permissions/pending")).json() == []


async def test_another_accounts_request_is_unknown(tmp_path):
    store = InMemorySecretStore()
    async with harness(tmp_path, store) as (client, turns, agent):
        task, _ = await _start_turn(client, turns, store, GRACE, "Grace's")
        request_id = turns.permissions._pending and next(iter(turns.permissions._pending))
        ProfileService(store).enroll(ADA)

        listing = (await client.get("/permissions/pending")).json()
        answer = await client.post(f"/permissions/pending/{request_id}", json={"allow": True})
        unknown = await client.post("/permissions/pending/no-such-request", json={"allow": True})

        assert listing == []
        assert (answer.status_code, unknown.status_code) == (404, 404)
        assert not agent.answers
        task.cancel()


async def test_a_remembered_decision_is_listed_and_revoked_by_its_account_only(tmp_path):
    store = InMemorySecretStore()
    async with harness(tmp_path, store) as (client, turns, _):
        task, _ = await _start_turn(client, turns, store, ADA, "Loops")
        request_id = (await client.get("/permissions/pending")).json()[0]["requestId"]
        await client.post(f"/permissions/pending/{request_id}", json={"allow": True, "remember": True})
        await asyncio.wait_for(task, 5)

        remembered = (await client.get("/permissions/remembered")).json()
        assert [(r["nodeTitle"], r["agentName"], r["kind"], r["allow"]) for r in remembered] == [
            ("Loops", "Codex", "edit", True)
        ]
        decision_id = remembered[0]["id"]

        ProfileService(store).enroll(GRACE)
        assert (await client.get("/permissions/remembered")).json() == []
        assert (await client.delete(f"/permissions/remembered/{decision_id}")).status_code == 404

        ProfileService(store).enroll(ADA)
        assert (await client.delete(f"/permissions/remembered/{decision_id}")).status_code == 204
        assert (await client.delete(f"/permissions/remembered/{decision_id}")).status_code == 404
        assert (await client.get("/permissions/remembered")).json() == []
