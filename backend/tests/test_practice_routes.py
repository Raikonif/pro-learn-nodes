"""Practice routes: scoped by account, append-only answers, code-only sandbox."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from api.dependencies.auth import get_profile_service
from api.routes.practice import router as practice_router
from core.secrets import InMemorySecretStore
from main import create_app
from service.identity.protocol import Identity
from service.profile_service import ProfileService

ADA = Identity(provider="dev", subject="ada", display_name="Ada")
GRACE = Identity(provider="dev", subject="grace", display_name="Grace")
MC = [{"text": "foldr", "correct": True}, {"text": "map", "correct": False}]


@asynccontextmanager
async def client_for(data_dir: Path, store: InMemorySecretStore) -> AsyncIterator[AsyncClient]:
    app = create_app(data_dir)
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


async def _node(client: AsyncClient, title: str = "Folds") -> str:
    graph = (await client.post("/workspace/nodes", json={"title": title})).json()["graph"]
    return max(graph["nodes"], key=lambda n: n["createdAt"])["id"]


def _requests() -> list[tuple[str, str]]:
    out = []
    for route in practice_router.routes:
        assert isinstance(route, APIRoute)
        path = route.path.format(**{name: "unused" for name in route.param_convertors})
        out += [(m, path) for m in sorted(route.methods - {"HEAD", "OPTIONS"})]
    return out


@pytest.mark.parametrize(("method", "path"), _requests())
async def test_every_practice_route_refuses_while_signed_out(method, path, tmp_path):
    async with client_for(tmp_path, InMemorySecretStore()) as client:
        response = await client.request(method, path, json={})
    assert response.status_code == 401, f"{method} {path}"


def test_the_router_has_exactly_these_routes():
    assert sorted(_requests()) == sorted([
        ("GET", "/practice/nodes/unused"),
        ("POST", "/practice/nodes/unused/items"),
        ("POST", "/practice/items/unused/attempts"),
        ("GET", "/practice/nodes/unused/sandbox"),
        ("PUT", "/practice/nodes/unused/sandbox"),
    ]), "no route edits or removes an attempt"


async def test_a_node_reads_items_attempts_and_sandbox_together(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        node = await _node(client)
        free = (await client.post(f"/practice/nodes/{node}/items", json={"kind": "free_response", "prompt": "What is a fold?", "referenceAnswer": "A reduction"})).json()
        mc = (await client.post(f"/practice/nodes/{node}/items", json={"kind": "multiple_choice", "prompt": "Which reduces?", "options": MC})).json()
        first = (await client.post(f"/practice/items/{free['id']}/attempts", json={"response": "It reduces"})).json()
        again = await client.post(f"/practice/items/{free['id']}/attempts", json={"response": "It reduces a structure"})
        chosen = (await client.post(f"/practice/items/{mc['id']}/attempts", json={"chosenOption": 1})).json()
        await client.put(f"/practice/nodes/{node}/sandbox", json={"code": "print(1)"})
        put_again = await client.put(f"/practice/nodes/{node}/sandbox", json={"code": "print(1)"})
        material = (await client.get(f"/practice/nodes/{node}")).json()

    assert free["referenceAnswer"] == "A reduction" and mc["options"] == MC
    assert again.status_code == 200 and again.json()["id"] != first["id"]
    assert (chosen["chosenOption"], chosen["correct"]) == (1, False)
    assert [i["id"] for i in material["items"]] == [free["id"], mc["id"]]
    assert [a["response"] for a in material["attempts"]][1:] == ["It reduces a structure", "It reduces"]
    assert material["attempts"][2] == first, "the first attempt is unchanged"
    assert put_again.status_code == 200 and material["sandbox"]["code"] == "print(1)"


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        ({"kind": "free_response", "prompt": "  "}, "prompt"),
        ({"kind": "multiple_choice", "prompt": "Q?", "options": [{"text": "a", "correct": True}]}, "two options"),
        ({"kind": "multiple_choice", "prompt": "Q?", "options": [{"text": "a"}, {"text": "b"}]}, "exactly one"),
        ({"kind": "multiple_choice", "prompt": "Q?", "options": [{"text": "a", "correct": True}, {"text": "b", "correct": True}]}, "exactly one"),
    ],
)
async def test_authoring_refusals_name_the_reason(tmp_path, body, reason):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        node = await _node(client)
        response = await client.post(f"/practice/nodes/{node}/items", json=body)
        material = (await client.get(f"/practice/nodes/{node}")).json()

    assert response.status_code == 422 and reason in response.json()["detail"]
    assert material["items"] == []


async def test_the_sandbox_carries_code_only(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        node = await _node(client)
        response = await client.put(f"/practice/nodes/{node}/sandbox", json={"code": "print(1)", "output": "1\n"})
    assert response.status_code == 422


async def test_another_accounts_node_and_item_are_not_found(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        service = ProfileService(store)
        service.enroll(GRACE)
        theirs = await _node(client, "Theirs")
        item = (await client.post(f"/practice/nodes/{theirs}/items", json={"kind": "free_response", "prompt": "Q?"})).json()
        service.enroll(ADA)
        answers = [
            (await client.get(f"/practice/nodes/{theirs}")).status_code,
            (await client.post(f"/practice/nodes/{theirs}/items", json={"kind": "free_response", "prompt": "Q?"})).status_code,
            (await client.post(f"/practice/items/{item['id']}/attempts", json={"response": "A"})).status_code,
            (await client.put(f"/practice/nodes/{theirs}/sandbox", json={"code": "x"})).status_code,
            (await client.get("/practice/nodes/no-such-node")).status_code,
        ]
    assert answers == [404, 404, 404, 404, 404]



async def test_a_code_exercise_through_the_routes(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        node = await _node(client)
        item = (await client.post(f"/practice/nodes/{node}/items", json={
            "kind": "code_exercise", "prompt": "Print six.", "starterCode": "# your code\n", "expectedOutput": "6"})).json()
        fresh = (await client.get(f"/practice/nodes/{node}/sandbox", params={"itemId": item["id"]})).json()
        await client.put(f"/practice/nodes/{node}/sandbox", params={"itemId": item["id"]}, json={"code": "print(6)"})
        saved = (await client.get(f"/practice/nodes/{node}/sandbox", params={"itemId": item["id"]})).json()
        free = (await client.get(f"/practice/nodes/{node}/sandbox")).json()
        attempt = (await client.post(f"/practice/items/{item['id']}/attempts", json={
            "code": "print(6)", "runOutcome": "completed", "runOutput": "6\n"})).json()

    assert (item["kind"], item["starterCode"], item["expectedOutput"], item["authoredBy"]) == ("code_exercise", "# your code\n", "6", None)
    assert fresh == {"code": "# your code\n", "updatedAt": None}
    assert saved["code"] == "print(6)" and free == {"code": "", "updatedAt": None}
    assert (attempt["response"], attempt["runOutcome"], attempt["correct"]) == ("print(6)", "completed", True)
