from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from api.dependencies.auth import get_profile_service
from core.database import session_scope
from core.exceptions import ValidationError
from core import migrations
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from main import create_app
from models.workspace import (
    ChatMessageRecord,
    ChatThreadRecord,
    SourceRecord,
    WorkspaceNodeRecord,
    WorkspaceRecord,
)
from service import retrieval, workspace as workspace_service
from service.identity.protocol import Identity
from service.profile_service import ProfileService


@pytest.fixture
async def ready_client(tmp_path: Path):
    """A client with an account signed in, because no route answers without one.

    Workspace routes derive their scope from the active account, so the
    session has to exist before any request below. The store is an
    `InMemorySecretStore` installed through `dependency_overrides` rather than
    the default `get_secret_store()`, which on macOS is the developer's real
    login keychain — a suite that used it would leave a session behind there.
    """

    app = create_app(tmp_path)
    store = InMemorySecretStore()
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    async with app.router.lifespan_context(app):
        ProfileService(store).enroll(
            Identity(provider="test", subject="workspace-persistence")
        )
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


async def bootstrap(client: AsyncClient) -> dict:
    response = await client.get("/workspace/bootstrap")
    assert response.status_code == 200
    return response.json()


def _workspace_id_of(profile_id: str) -> str:
    """The workspace an account owns, provisioned when it was enrolled."""

    with session_scope() as session:
        return session.exec(
            select(WorkspaceRecord.id).where(WorkspaceRecord.profile_id == profile_id)
        ).one()


def seed_conversation(workspace_id: str) -> tuple[str, str, str]:
    with session_scope() as session:
        node = WorkspaceNodeRecord(
            workspace_id=workspace_id,
            title="Persistence node",
            mode="Explore",
        )
        session.add(node)
        session.flush()
        thread = ChatThreadRecord(workspace_id=workspace_id, node_id=node.id, name="main")
        session.add(thread)
        session.flush()
        message = ChatMessageRecord(
            workspace_id=workspace_id,
            thread_id=thread.id,
            role="agent",
            content="A durable branch keeps its selected passage.",
        )
        session.add(message)
        return node.id, thread.id, message.id


@pytest.mark.asyncio
async def test_liveness_and_readiness_are_distinct(tmp_path: Path):
    app = create_app(tmp_path)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        health = await client.get("/health")
        ready = await client.get("/ready")
        bootstrap_response = await client.get("/workspace/bootstrap")
    assert health.status_code == 200
    assert ready.status_code == 503
    assert bootstrap_response.status_code == 503


@pytest.mark.asyncio
async def test_first_launch_bootstrap_is_empty_and_revisioned(ready_client: AsyncClient):
    response = await ready_client.get("/ready")
    assert response.status_code == 200
    first = await bootstrap(ready_client)
    second = await bootstrap(ready_client)
    assert first["schemaVersion"] == 1
    assert first["revision"] == 0
    assert first["graph"] == {"nodes": [], "links": [], "threads": [], "messages": []}
    assert second["workspaceId"] == first["workspaceId"]


@pytest.mark.asyncio
async def test_branch_is_persisted_atomically_with_anchor_and_main_thread(ready_client: AsyncClient):
    initial = await bootstrap(ready_client)
    node_id, _thread_id, message_id = seed_conversation(initial["workspaceId"])
    anchor = {
        "messageId": message_id,
        "start": 2,
        "end": 16,
        "excerpt": "durable branch",
    }
    response = await ready_client.post(
        "/workspace/nodes/branch",
        json={
            "sourceNodeId": node_id,
            "anchor": anchor,
        },
    )
    assert response.status_code == 200
    snapshot = response.json()
    assert snapshot["revision"] == 1
    link = next(link for link in snapshot["graph"]["links"] if link["parentId"] == node_id)
    child = next(node for node in snapshot["graph"]["nodes"] if node["id"] == link["childId"])
    child_threads = [thread for thread in snapshot["graph"]["threads"] if thread["nodeId"] == child["id"]]
    assert link["anchor"] == anchor
    assert child_threads == [
        {"id": child_threads[0]["id"], "nodeId": child["id"], "name": "main", "anchor": None}
    ]


@pytest.mark.asyncio
async def test_context_update_does_not_change_graph_content(ready_client: AsyncClient):
    initial = await bootstrap(ready_client)
    node_id, _thread_id, _message_id = seed_conversation(initial["workspaceId"])
    before = await bootstrap(ready_client)
    response = await ready_client.put(
        "/workspace/context",
        json={
            "lastOpenNodeId": node_id,
            "viewport": {"x": 4, "y": 8, "zoom": 1.2},
        },
    )
    after = response.json()
    assert response.status_code == 200
    # Opening a session is activity (session-history), so its activity
    # timestamps move — and nothing else in the graph does: every node, link,
    # thread, and message is otherwise identical.
    moved = ("lastOpenedAt", "lastActivityAt")
    strip = lambda graph: {  # noqa: E731
        **graph,
        "nodes": [{k: v for k, v in n.items() if k not in moved} for n in graph["nodes"]],
    }
    assert strip(after["graph"]) == strip(before["graph"])
    opened = next(n for n in after["graph"]["nodes"] if n["id"] == node_id)
    was = next(n for n in before["graph"]["nodes"] if n["id"] == node_id)
    assert opened["lastActivityAt"] > was["lastActivityAt"]
    assert after["context"] == {
        "lastOpenNodeId": node_id,
        "viewport": {"x": 4, "y": 8, "zoom": 1.2},
    }


@pytest.mark.asyncio
async def test_retrieval_is_workspace_scoped_and_attributable(ready_client: AsyncClient):
    initial = await bootstrap(ready_client)
    source = await ready_client.post(
        "/workspace/sources",
        json={
            "title": "Local notes",
            "content": "SQLite FTS keeps local retrieval private and fast.",
            "metadata": {"kind": "note"},
        },
    )
    assert source.status_code == 200
    results = await ready_client.get(
        "/workspace/retrieval",
        params={"query": "local retrieval"},
    )
    assert results.status_code == 200
    match = results.json()["results"][0]
    assert match["sourceTitle"] == "Local notes"
    assert "local retrieval" in match["content"].lower()


def test_resume_replaces_abandoned_index_work_and_keeps_workspaces_isolated(tmp_path: Path):
    from core.runtime import initialize_local_data

    initialize_local_data(tmp_path)
    # Two workspaces now means two accounts: every workspace has an owner, so
    # they are provisioned by enrolling rather than by inserting a bare row.
    # It also makes the isolation this test asserts the real one — a passage
    # indexed under one learner must not be findable by another.
    service = ProfileService(InMemorySecretStore())
    first_workspace_id = _workspace_id_of(
        service.enroll(Identity(provider="test", subject="resume-first")).id
    )
    second_workspace_id = _workspace_id_of(
        service.enroll(Identity(provider="test", subject="resume-second")).id
    )
    first = retrieval.create_source(first_workspace_id, "First", "unique first workspace phrase")
    second = retrieval.create_source(second_workspace_id, "Second", "unique second workspace phrase")
    with session_scope() as session:
        abandoned = session.get(SourceRecord, first.id)
        assert abandoned is not None
        abandoned.index_status = "running"

    retrieval.resume_unfinished_indexing()

    assert retrieval.source_status(first_workspace_id)[0]["status"] == "completed"
    assert retrieval.source_status(second_workspace_id)[0]["status"] == "completed"
    assert retrieval.search(first_workspace_id, "second workspace") == []
    assert retrieval.search(second_workspace_id, "second workspace")[0]["sourceTitle"] == "Second"


def test_validation_rejects_a_node_without_its_main_thread(tmp_path: Path):
    app = create_app(tmp_path)
    # The synchronous initializer is the same function used by the lifespan.
    from core.runtime import initialize_local_data

    initialize_local_data(tmp_path)
    workspace_id = _workspace_id_of(
        ProfileService(InMemorySecretStore())
        .enroll(Identity(provider="test", subject="validation"))
        .id
    )
    with session_scope() as session:
        session.add(
            WorkspaceNodeRecord(
                workspace_id=workspace_id,
                title="Broken node",
                mode="Explore",
            )
        )
    with pytest.raises(ValidationError, match="exactly one main thread"):
        workspace_service.validate_workspace_data()


def test_existing_database_is_backed_up_before_migration(tmp_path: Path):
    from core.database import configure_database, database_path

    configure_database(tmp_path)
    migrate_database(database_path())
    migrate_database(database_path())
    assert list((tmp_path / "backups").glob("workspace-*.sqlite3"))


def test_failed_migration_preserves_a_backup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database = tmp_path / "workspace.sqlite3"
    database.write_bytes(b"learner data")
    monkeypatch.setattr(migrations.command, "upgrade", lambda *_args: (_ for _ in ()).throw(RuntimeError("boom")))

    with pytest.raises(RuntimeError, match="boom"):
        migrations.migrate_database(database)

    backup = next((tmp_path / "backups").glob("workspace-*.sqlite3"))
    assert backup.read_bytes() == b"learner data"
