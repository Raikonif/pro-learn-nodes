"""Search and the derived index it reads never cross an account boundary.

`service/retrieval.py` keeps a second, *derived* copy of every source: chunks
in `source_chunks` and an FTS projection in `source_chunk_fts`, both shared by
every account on the device. That is the part of the workspace where
confinement is easiest to lose without anyone noticing — the routes are
scoped, the tables are not, and a single dropped `WHERE f.workspace_id = ...`
returns another learner's material with a 200 rather than an error anyone
would investigate. Nothing asserted this property before this file, so it
could have regressed silently.

Everything below is driven through HTTP, sign-in included, because the claim
is about what a learner can reach and not about what the service layer accepts
when handed an id directly. `test_workspace_persistence.py` already covers the
service functions; the gap here was the route path.

Each test seeds *both* accounts with content matching the same query. A
confinement test whose search returns nothing at all would pass against a
retrieval layer that was simply broken, so the assertions are equalities on
the whole result set: what came back, and nothing else.

`ProfileService()` defaults its store to the developer's real macOS login
keychain, so the client below installs an `InMemorySecretStore` through
`app.dependency_overrides` — the same reason `get_profile_service` exists.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from api.dependencies.auth import get_profile_service
from core.config import Settings
from core.secrets import InMemorySecretStore
from main import create_app
from service import identity as identity_registry
from service.profile_service import ProfileService

ADA = "ada@example.com"
GRACE = "grace@example.com"

# Both passages match `SHARED_QUERY`. If the scope ever widened, the search
# below would return two rows rather than none, which is a far more honest
# failure than one that cannot tell a leak from an empty index.
ADA_PASSAGE = "Quicksort recursion depth is bounded by the median-of-three pivot rule."
GRACE_PASSAGE = "Quicksort throughput improves when the pivot is chosen at random."
SHARED_QUERY = "quicksort pivot"


@pytest.fixture
def store() -> InMemorySecretStore:
    return InMemorySecretStore()


@pytest.fixture
def dev_auth(monkeypatch):
    """Open the development sign-in gate for the app built after this runs.

    `settings` is a frozen singleton read at import and the registry captures
    the gate's answer when the router is assembled, so both halves are needed:
    the environment variable makes the value legitimate, and rebuilding
    `Settings` is what lets the registry see it.
    """

    monkeypatch.setenv("LEARN_NODES_DEV_AUTH", "1")
    monkeypatch.setattr(identity_registry, "settings", Settings())


@asynccontextmanager
async def retrieval_client(
    data_dir: Path, store: InMemorySecretStore
) -> AsyncIterator[AsyncClient]:
    app = create_app(data_dir)
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


async def sign_in(client: AsyncClient, email: str) -> None:
    """Enrol on first use and activate on every use — one account per email."""

    response = await client.post("/auth/dev/signin", json={"email": email})
    assert response.status_code == 200, response.text


async def sign_out(client: AsyncClient) -> None:
    response = await client.post("/auth/signout", json={})
    assert response.status_code == 200, response.text


async def add_indexed_source(client: AsyncClient, title: str, content: str) -> str:
    """Create a source and return once its chunks are searchable.

    `POST /workspace/sources` defers indexing to a `BackgroundTask`, which
    Starlette runs before the response leaves the ASGI app, so the status this
    asserts is the finished one rather than a race.
    """

    response = await client.post(
        "/workspace/sources", json={"title": title, "content": content}
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def search(client: AsyncClient, query: str) -> list[dict]:
    response = await client.get("/workspace/retrieval", params={"query": query})
    assert response.status_code == 200, response.text
    return response.json()["results"]


async def seed_both_accounts(client: AsyncClient) -> None:
    """Ada's passage, then Grace's, leaving Grace active."""

    await sign_in(client, ADA)
    await add_indexed_source(client, "Ada's notes", ADA_PASSAGE)
    await sign_out(client)

    await sign_in(client, GRACE)
    await add_indexed_source(client, "Grace's notes", GRACE_PASSAGE)


async def test_a_passage_indexed_by_one_account_is_absent_from_the_others_search(
    dev_auth, tmp_path: Path, store: InMemorySecretStore
):
    """The spec's "search does not span accounts", end to end over HTTP.

    Asserted as an equality rather than a `not in`: the interesting failure is
    two rows, and the uninteresting one — zero rows because retrieval stopped
    working — has to fail too, or the test protects nothing.
    """

    async with retrieval_client(tmp_path, store) as client:
        await seed_both_accounts(client)

        grace_results = await search(client, SHARED_QUERY)

    assert [result["content"] for result in grace_results] == [GRACE_PASSAGE]
    assert [result["sourceTitle"] for result in grace_results] == ["Grace's notes"]


async def test_confinement_survives_a_rebuild_of_the_derived_index(
    dev_auth, tmp_path: Path, store: InMemorySecretStore
):
    """The spec's "rebuilding an index preserves confinement".

    Rebuilding is the operation most likely to widen a scope by accident,
    because it repopulates a table every account shares. Two failures are in
    scope and both are checked: a rebuild run by Grace that pulls Ada's
    sources into Grace's results, and one that deletes rows it does not own,
    leaving Ada's material unfindable by Ada.
    """

    async with retrieval_client(tmp_path, store) as client:
        await seed_both_accounts(client)

        rebuilt = await client.post("/workspace/retrieval/rebuild", json={})
        grace_results = await search(client, SHARED_QUERY)

        await sign_out(client)
        await sign_in(client, ADA)
        ada_results = await search(client, SHARED_QUERY)

    assert rebuilt.status_code == 200
    assert [result["content"] for result in grace_results] == [GRACE_PASSAGE]
    # Intact as well as confined: Ada never asked for the rebuild and must not
    # be able to tell that one happened.
    assert [result["content"] for result in ada_results] == [ADA_PASSAGE]


async def test_the_source_listing_does_not_show_another_accounts_sources(
    dev_auth, tmp_path: Path, store: InMemorySecretStore
):
    """`source_status` is a separate query from `search` and can drift alone.

    Beyond the two scenarios in the spec, but cheap: the listing is what the
    library UI renders, so a leak here shows another learner's document titles
    without any search being performed.
    """

    async with retrieval_client(tmp_path, store) as client:
        await seed_both_accounts(client)

        listed = await client.get("/workspace/sources")

    assert listed.status_code == 200
    assert [source["title"] for source in listed.json()["sources"]] == ["Grace's notes"]
