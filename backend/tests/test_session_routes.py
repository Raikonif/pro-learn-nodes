"""The session routes: create, rename, archive, restore, search — never delete."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from api.dependencies.auth import get_profile_service
from api.routes.workspace import router as workspace_router
from core.secrets import InMemorySecretStore
from main import create_app
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


def _newest(graph: dict) -> dict:
    return max(graph["nodes"], key=lambda n: n["createdAt"])


async def test_quick_and_detailed_starts(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        quick = _newest((await client.post("/workspace/nodes", json={})).json()["graph"])
        detailed = _newest(
            (await client.post("/workspace/nodes", json={"title": "Monads", "mode": "Deepen"})).json()["graph"]
        )

    assert (quick["title"], quick["titleSource"], quick["mode"]) == ("New session", "provisional", "Explore")
    assert (detailed["title"], detailed["titleSource"], detailed["mode"]) == ("Monads", "topic", "Deepen")


async def test_rename_archive_restore_and_search(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        graph = (await client.post("/workspace/nodes", json={})).json()["graph"]
        node = _newest(graph)["id"]
        thread = next(t["id"] for t in graph["threads"] if t["nodeId"] == node)
        await client.post("/workspace/messages", json={"threadId": thread, "role": "learner", "content": "hylomorphism"})

        renamed = await client.put(f"/workspace/nodes/{node}/title", json={"title": "Schemes"})
        empty = await client.put(f"/workspace/nodes/{node}/title", json={"title": ""})
        found = (await client.get("/workspace/sessions/search", params={"q": "hylomorphism"})).json()
        archived = (await client.post(f"/workspace/nodes/{node}/archive")).json()
        hidden = (await client.get("/workspace/sessions/search", params={"q": "hylomorphism"})).json()
        with_archived = (
            await client.get("/workspace/sessions/search", params={"q": "hylomorphism", "includeArchived": "true"})
        ).json()
        restored = (await client.post(f"/workspace/nodes/{node}/restore")).json()

    assert renamed.status_code == 200 and _newest(renamed.json()["graph"])["title"] == "Schemes"
    assert empty.status_code == 422
    assert [r["nodeId"] for r in found["results"]] == [node]
    assert node not in {n["id"] for n in archived["graph"]["nodes"]}
    assert hidden["results"] == []
    assert [(r["nodeId"], r["archived"]) for r in with_archived["results"]] == [(node, True)]
    assert node in {n["id"] for n in restored["graph"]["nodes"]}


async def test_another_accounts_session_is_answered_as_missing(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        service = ProfileService(store)
        service.enroll(GRACE)
        theirs = _newest((await client.post("/workspace/nodes", json={"title": "Grace's"})).json()["graph"])["id"]
        service.enroll(ADA)
        answers = [
            (await client.put(f"/workspace/nodes/{theirs}/title", json={"title": "x"})).status_code,
            (await client.post(f"/workspace/nodes/{theirs}/archive")).status_code,
            (await client.post(f"/workspace/nodes/{theirs}/restore")).status_code,
            (await client.post("/workspace/nodes/no-such-node/archive")).status_code,
        ]

    assert answers == [404, 404, 404, 404]


def test_no_route_deletes_a_session():
    """The history archives; it never deletes."""

    for route in workspace_router.routes:
        assert isinstance(route, APIRoute)
        assert "DELETE" not in route.methods, route.path
