"""The workspace a request may reach is the active account's, and only that one.

The claims, in the order they matter. The scope is resolved from the session
rather than from anything the caller sent. A signed-out request is refused with
a signal the frontend can act on, and signing out makes that immediate rather
than eventual. A caller who names another account's data is answered exactly as
one who names data that never existed, so the answer carries no information
about which it was. And the refusal covers *every* workspace route, enumerated
from the router so a route added tomorrow is covered without anyone
remembering to add it here.

`ProfileService()` would otherwise store the session in the developer's real
macOS login keychain, so every client below installs an `InMemorySecretStore`
through `app.dependency_overrides` and the direct tests construct the service
with one explicitly.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from api.dependencies.auth import (
    get_profile_service,
    require_active_profile,
    require_workspace_scope,
)
from api.routes.workspace import router as workspace_router
from repository import project_repo
from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from main import create_app
from models.workspace import WorkspaceNodeRecord, WorkspaceRecord
from service.identity.protocol import Identity
from service.profile_service import ProfileService

LEARNER = Identity(provider="dev", subject="learner-1", display_name="Ada")
OTHER_LEARNER = Identity(provider="dev", subject="learner-2", display_name="Grace")


@pytest.fixture
def store() -> InMemorySecretStore:
    return InMemorySecretStore()


@pytest.fixture
def migrated_database(tmp_path: Path) -> Path:
    """Point the process-wide engine at an empty, fully migrated database.

    The engine is global state the whole session shares, so each test
    re-points it at its own `tmp_path`.
    """

    configure_database(tmp_path)
    migrate_database(database_path())
    return tmp_path


def _workspace_id_of(profile_id: str) -> str:
    with session_scope() as session:
        return session.exec(
            select(WorkspaceRecord.id).where(WorkspaceRecord.profile_id == profile_id)
        ).one()


@asynccontextmanager
async def scoped_client(
    data_dir: Path, store: InMemorySecretStore
) -> AsyncIterator[AsyncClient]:
    app = create_app(data_dir)
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


# --- The dependency itself ------------------------------------------------


def test_scope_is_the_active_accounts_workspace(
    migrated_database: Path, store: InMemorySecretStore
):
    service = ProfileService(store)
    profile = service.enroll(LEARNER)

    assert require_workspace_scope(profile) == _workspace_id_of(profile.id)


def test_scope_follows_the_session_rather_than_the_last_enrolment(
    migrated_database: Path, store: InMemorySecretStore
):
    """Two accounts on one device must not share a scope."""

    service = ProfileService(store)
    first = service.enroll(LEARNER)
    second = service.enroll(OTHER_LEARNER)

    assert require_workspace_scope(require_active_profile(service)) == _workspace_id_of(
        second.id
    )

    service.activate(first.id)

    assert require_workspace_scope(require_active_profile(service)) == _workspace_id_of(
        first.id
    )


def test_no_active_account_is_refused_as_authentication_required(
    migrated_database: Path, store: InMemorySecretStore
):
    """401, not 404: the frontend has to tell "sign in" from "that is gone"."""

    with pytest.raises(HTTPException) as refusal:
        require_active_profile(ProfileService(store))

    assert refusal.value.status_code == 401


def test_sign_out_ends_access_with_no_interval_elapsing(
    migrated_database: Path, store: InMemorySecretStore
):
    """Nothing is advanced between the two calls — not a clock, not a fixture.

    The session is a pointer that sign-out deletes, so there is no expiry for
    a test to have to wait out; if this ever needs a sleep, the session has
    grown a lifetime it is not supposed to have.
    """

    service = ProfileService(store)
    service.enroll(LEARNER)
    assert require_active_profile(service) is not None

    service.sign_out()

    with pytest.raises(HTTPException) as refusal:
        require_active_profile(service)
    assert refusal.value.status_code == 401


# --- The routes -----------------------------------------------------------


async def test_bootstrap_returns_the_active_accounts_workspace_unasked(
    tmp_path: Path, store: InMemorySecretStore
):
    async with scoped_client(tmp_path, store) as client:
        service = ProfileService(store)
        profile = service.enroll(LEARNER)

        response = await client.get("/workspace/bootstrap")

    assert response.status_code == 200
    assert response.json()["workspaceId"] == _workspace_id_of(profile.id)


async def test_a_named_workspace_cannot_redirect_the_scope(
    tmp_path: Path, store: InMemorySecretStore
):
    """A `workspaceId` from the caller decides nothing and reaches nothing.

    The parameter is gone from every route, so an older client still sending
    one is answered from its own scope rather than refused — the server was
    never going to honour it. What matters is the two negatives: the other
    account's data is not returned, and the node created here does not land in
    the other account's workspace.
    """

    async with scoped_client(tmp_path, store) as client:
        service = ProfileService(store)
        other = service.enroll(OTHER_LEARNER)
        other_workspace = _workspace_id_of(other.id)
        learner = service.enroll(LEARNER)
        own_workspace = _workspace_id_of(learner.id)

        bootstrap = await client.get(
            "/workspace/bootstrap", params={"workspaceId": other_workspace}
        )
        created = await client.post(
            "/workspace/nodes",
            json={"workspaceId": other_workspace, "title": "Mine", "mode": "Explore"},
        )

    assert bootstrap.status_code == 200
    assert bootstrap.json()["workspaceId"] == own_workspace
    assert created.status_code == 200
    with session_scope() as session:
        intruders = session.exec(
            select(WorkspaceNodeRecord).where(
                WorkspaceNodeRecord.workspace_id == other_workspace
            )
        ).all()
    assert intruders == []


async def test_another_accounts_data_is_refused_exactly_as_absent_data_is(
    tmp_path: Path, store: InMemorySecretStore
):
    """The refusal must not reveal whether the named thing exists.

    Both requests are answered 404 with a body that repeats only the
    identifier the caller supplied, so the two are identical once that
    identifier is masked. A body that said "not yours" for one and "unknown"
    for the other would let a caller enumerate another account's graph.
    """

    async with scoped_client(tmp_path, store) as client:
        service = ProfileService(store)
        other = service.enroll(OTHER_LEARNER)
        with session_scope() as session:
            hidden = WorkspaceNodeRecord(
                workspace_id=_workspace_id_of(other.id),
                project_id=project_repo.default_for(session, _workspace_id_of(other.id)).id,
                title="Someone else's node",
                mode="Explore",
            )
            session.add(hidden)
            session.flush()
            hidden_node_id = hidden.id

        service.enroll(LEARNER)
        missing_node_id = str(uuid4())

        cross_account = await client.post(
            "/workspace/nodes/child", json={"parentNodeId": hidden_node_id}
        )
        nonexistent = await client.post(
            "/workspace/nodes/child", json={"parentNodeId": missing_node_id}
        )

    assert cross_account.status_code == nonexistent.status_code == 404
    assert cross_account.json()["detail"].replace(hidden_node_id, "<id>") == nonexistent.json()[
        "detail"
    ].replace(missing_node_id, "<id>")


def _workspace_requests() -> list[tuple[str, str]]:
    """Every (method, path) the workspace router exposes.

    Enumerated from the router rather than listed by hand so a route added
    later is covered by the signed-out test without anyone remembering to come
    back here — which is precisely the kind of remembering this whole change
    exists to stop relying on.
    """

    requests: list[tuple[str, str]] = []
    for route in workspace_router.routes:
        assert isinstance(route, APIRoute)
        path = route.path.format(
            **{name: "unused" for name in route.param_convertors}
        )
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            requests.append((method, path))
    return requests


@pytest.mark.parametrize(("method", "path"), _workspace_requests())
async def test_every_workspace_route_refuses_while_signed_out(
    method: str, path: str, tmp_path: Path, store: InMemorySecretStore
):
    """No body or query is supplied on purpose.

    FastAPI solves dependencies before it validates a request's own
    parameters, so an unauthenticated request is refused before its payload is
    read. A 422 here would mean the route inspected what a signed-out caller
    sent, and the assertion below is what keeps that from creeping back.
    """

    async with scoped_client(tmp_path, store) as client:
        response = await client.request(method, path, json={})

    assert response.status_code == 401, f"{method} {path}"


def test_the_signed_out_test_covers_the_whole_router():
    """A guard on the guard: an empty enumeration would pass silently."""

    assert len(_workspace_requests()) == len(workspace_router.routes) == 26
