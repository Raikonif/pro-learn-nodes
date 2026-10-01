"""Memory routes: the learner's decisions, scoped by account."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from api.dependencies.auth import get_profile_service
from api.routes.memory import router as memory_router
from core.secrets import InMemorySecretStore
from main import create_app
from service import memory_service
from service.identity.protocol import Identity
from service.profile_service import ProfileService

ADA = Identity(provider="dev", subject="ada", display_name="Ada")
GRACE = Identity(provider="dev", subject="grace", display_name="Grace")


@asynccontextmanager
async def client_for(data_dir: Path, store: InMemorySecretStore) -> AsyncIterator[AsyncClient]:
    app = create_app(data_dir)
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


def _requests() -> list[tuple[str, str]]:
    out = []
    for route in memory_router.routes:
        assert isinstance(route, APIRoute)
        path = route.path.format(**{name: "unused" for name in route.param_convertors})
        out += [(m, path) for m in sorted(route.methods - {"HEAD", "OPTIONS"})]
    return out


def _propose(profile_id: str, text: str, topic: str | None = None, node: str | None = None) -> dict:
    return memory_service.propose(
        profile_id, text=text, topic=topic, proposed_by_name="Codex", source_node_id=node
    )


def test_the_router_has_exactly_the_memory_routes():
    assert sorted(_requests()) == sorted([
        ("GET", "/memory"),
        ("GET", "/memory/export"),
        ("POST", "/memory/unused/accept"),
        ("POST", "/memory/unused/reject"),
        ("PUT", "/memory/unused"),
        ("DELETE", "/memory/unused"),
    ])


@pytest.mark.parametrize(("method", "path"), _requests())
async def test_every_memory_route_refuses_while_signed_out(method, path, tmp_path):
    async with client_for(tmp_path, InMemorySecretStore()) as client:
        response = await client.request(method, path, json={})
    assert response.status_code == 401, f"{method} {path}"


async def test_the_learner_lists_accepts_edits_and_removes(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ada = ProfileService(store).enroll(ADA)
        graph = (await client.post("/workspace/nodes", json={"title": "Folds"})).json()["graph"]
        node = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]
        one = _propose(ada.id, "Knows folds", topic="folds", node=node)
        two = _propose(ada.id, "Knows monads")

        listing = (await client.get("/memory")).json()
        accepted = await client.post(f"/memory/{one['id']}/accept", json={"text": "Knows foldr"})
        rejected = await client.post(f"/memory/{two['id']}/reject")
        revision = _propose(ada.id, "Knows foldr and foldl", topic="folds")
        pending_revision = (await client.get("/memory")).json()["pending"][0]
        accepted_revision = await client.post(f"/memory/{revision['id']}/accept")
        edited = await client.put(f"/memory/{revision['id']}", json={"text": "Masters folds"})
        exported = await client.get("/memory/export")
        removed = await client.delete(f"/memory/{edited.json()['id']}")
        after = (await client.get("/memory")).json()

    assert [m["text"] for m in listing["pending"]] == ["Knows monads", "Knows folds"]
    first = listing["pending"][1]
    assert set(first) == {"id", "text", "topic", "status", "proposedBy", "sourceNodeId", "sourceTitle", "createdAt", "decidedAt", "revises", "history"}
    assert (first["proposedBy"], first["sourceTitle"], first["status"]) == ("Codex", "Folds", "pending")
    assert accepted.status_code == 200 and accepted.json()["text"] == "Knows foldr"
    assert rejected.json()["status"] == "rejected"
    assert pending_revision["revises"] == {"id": one["id"], "text": "Knows foldr"}
    assert [h["text"] for h in accepted_revision.json()["history"]] == ["Knows foldr"]
    assert edited.status_code == 200
    assert [h["text"] for h in edited.json()["history"]] == ["Knows foldr", "Knows foldr and foldl"]
    assert exported.status_code == 200 and exported.headers["content-type"].startswith("text/markdown")
    assert exported.text.startswith("# Memory") and "Masters folds" in exported.text
    assert removed.status_code == 204
    assert after == {"pending": [], "accepted": []}


async def test_refusals_are_422_with_a_reason(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ada = ProfileService(store).enroll(ADA)
        memory = _propose(ada.id, "Knows folds")
        empty = await client.post(f"/memory/{memory['id']}/accept", json={"text": "  "})
        not_accepted = await client.delete(f"/memory/{memory['id']}")
        await client.post(f"/memory/{memory['id']}/reject")
        twice = await client.post(f"/memory/{memory['id']}/reject")

    for response in (empty, not_accepted, twice):
        assert response.status_code == 422
        assert isinstance(response.json()["detail"], str) and response.json()["detail"]


async def test_another_accounts_memory_is_not_found(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        service = ProfileService(store)
        grace = service.enroll(GRACE)
        pending = _propose(grace.id, "Grace's pending")
        accepted = memory_service.accept(grace.id, _propose(grace.id, "Grace's fact")["id"], None)
        service.enroll(ADA)
        answers = [
            (await client.post(f"/memory/{pending['id']}/accept", json={})).status_code,
            (await client.post(f"/memory/{pending['id']}/reject")).status_code,
            (await client.put(f"/memory/{accepted['id']}", json={"text": "x"})).status_code,
            (await client.delete(f"/memory/{accepted['id']}")).status_code,
            (await client.delete("/memory/no-such-memory")).status_code,
        ]
        listing = (await client.get("/memory")).json()
        exported = (await client.get("/memory/export")).text

    assert answers == [404, 404, 404, 404, 404]
    assert listing == {"pending": [], "accepted": []}
    assert "Grace" not in exported
