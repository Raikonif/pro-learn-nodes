"""The project migrations: a table, a nullable membership with a backfill, then non-null."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from tests.test_profile_migration import WORKSPACE_FOUNDATION, _downgrade_to, _seed_workspace_foundation, _upgrade_to

DELIVERY_ID = "20261005_01"
PROJECTS = "20261006_01"
NODE_PROJECTS = "20261006_02"
REQUIRED = "20261006_03"


def _populated(tmp_path: Path) -> Path:
    """Two workspaces, three nodes, a link between two of them, a thread and a message each."""

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)
    _upgrade_to(database, DELIVERY_ID)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        c.execute(text(
            "INSERT INTO workspace_nodes (id, workspace_id, title, mode, body, active_skills, mcp_servers,"
            " created_at, last_opened_at, last_activity_at)"
            " VALUES ('node-2', 'ws-1', 'Second', 'Explore', '', '[]', '[]',"
            " '2026-08-21 11:00:00', '2026-08-21 11:00:00', '2026-08-21 11:00:00')"
        ))
        c.execute(text("INSERT INTO chat_threads (id, workspace_id, node_id, name) VALUES ('thread-2', 'ws-1', 'node-2', 'main')"))
        c.execute(text("INSERT INTO node_links (id, workspace_id, parent_id, child_id) VALUES ('link-1', 'ws-1', 'node-1', 'node-2')"))
    engine.dispose()
    return database


def _rows(database: Path, sql: str) -> list[tuple]:
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        rows = [tuple(r) for r in c.execute(text(sql))]
    engine.dispose()
    return rows


def _columns(database: Path, table: str) -> dict[str, int]:
    return {r[1]: r[3] for r in _rows(database, f"PRAGMA table_info({table})")}


def _indexes(database: Path) -> set[str]:
    return {r[0] for r in _rows(database, "SELECT name FROM sqlite_master WHERE type='index'")}


def _fingerprint(database: Path) -> dict[str, list[tuple]]:
    return {
        "links": _rows(database, "SELECT id, parent_id, child_id FROM node_links ORDER BY id"),
        "threads": _rows(database, "SELECT id, node_id, name FROM chat_threads ORDER BY id"),
        "messages": _rows(database, "SELECT id, thread_id, content FROM chat_messages ORDER BY id"),
        "nodes": _rows(database, "SELECT id, workspace_id, title, body FROM workspace_nodes ORDER BY id"),
    }


def test_the_projects_table_and_one_default_rule_are_created_without_touching_nodes(tmp_path):
    database = _populated(tmp_path)
    before = _fingerprint(database)
    _upgrade_to(database, PROJECTS)

    assert _rows(database, "SELECT count(*) FROM projects") == [(0,)]
    assert "project_context" in _columns(database, "agent_sessions")
    assert "project_id" not in _columns(database, "workspace_nodes")
    assert {"uq_default_project_per_workspace", "ix_projects_workspace_id"} <= _indexes(database)
    assert _fingerprint(database) == before

    engine = create_engine(f"sqlite:///{database}")
    insert = text("INSERT INTO projects (id, workspace_id, name, instructions, is_default, created_at)"
                  " VALUES (:id, 'ws-1', 'x', '', :d, '2026-10-06 10:00:00')")
    with engine.begin() as c:
        c.execute(insert, {"id": "a", "d": 1})
        c.execute(insert, {"id": "b", "d": 0})
        c.execute(insert, {"id": "c", "d": 0})
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(insert, {"id": "d", "d": 1})
    engine.dispose()


def test_every_node_is_attached_to_its_workspaces_default_and_nothing_else_changes(tmp_path):
    database = _populated(tmp_path)
    before = _fingerprint(database)
    _upgrade_to(database, NODE_PROJECTS)

    [(project_id, name, is_default)] = _rows(database, "SELECT id, name, is_default FROM projects")
    assert (name, is_default) == ("General", 1)
    assert _rows(database, "SELECT id, project_id, archived_with_project_id FROM workspace_nodes ORDER BY id") == [
        ("node-1", project_id, None), ("node-2", project_id, None),
    ]
    assert _fingerprint(database) == before
    assert "ix_workspace_nodes_project_id" in _indexes(database)


def test_the_backfill_is_idempotent(tmp_path):
    database = _populated(tmp_path)
    _upgrade_to(database, NODE_PROJECTS)
    first = _rows(database, "SELECT id, project_id FROM workspace_nodes ORDER BY id")
    projects = _rows(database, "SELECT id FROM projects")

    # Running the step again over data it already migrated: the downgrade
    # removes the columns but leaves the default project, so this is the second
    # run of the backfill against a workspace that already has one.
    _downgrade_to(database, PROJECTS)
    _upgrade_to(database, NODE_PROJECTS)

    assert _rows(database, "SELECT id FROM projects") == projects
    assert _rows(database, "SELECT id, project_id FROM workspace_nodes ORDER BY id") == first


def test_an_existing_default_project_is_reused_not_duplicated(tmp_path):
    database = _populated(tmp_path)
    _upgrade_to(database, PROJECTS)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        c.execute(text("INSERT INTO projects (id, workspace_id, name, instructions, is_default, created_at)"
                       " VALUES ('mine', 'ws-1', 'Renamed', '', 1, '2026-10-06 10:00:00')"))
    engine.dispose()

    _upgrade_to(database, NODE_PROJECTS)

    assert _rows(database, "SELECT id, name FROM projects") == [("mine", "Renamed")]
    assert {r[1] for r in _rows(database, "SELECT id, project_id FROM workspace_nodes")} == {"mine"}


def test_the_final_step_requires_a_project_and_keeps_indexes_and_references(tmp_path):
    database = _populated(tmp_path)
    before = _fingerprint(database)
    indexes_before = _indexes(database)
    _upgrade_to(database, REQUIRED)

    assert _columns(database, "workspace_nodes")["project_id"] == 1, "notnull"
    assert indexes_before - {"ix_workspace_nodes_project_id"} <= _indexes(database)
    assert "ix_workspace_nodes_project_id" in _indexes(database)
    assert {(r[2], r[3], r[4]) for r in _rows(database, "PRAGMA foreign_key_list(workspace_nodes)")} == {
        ("workspaces", "workspace_id", "id"), ("projects", "project_id", "id"),
    }
    for child, column in (("chat_threads", "node_id"), ("node_links", "parent_id"), ("node_links", "child_id")):
        assert ("workspace_nodes", column, "id") in {
            (r[2], r[3], r[4]) for r in _rows(database, f"PRAGMA foreign_key_list({child})")
        }
    assert _fingerprint(database) == before
    assert "uq_main_thread_per_node" in _indexes(database)
    assert "uq_default_project_per_workspace" in _indexes(database)


def test_downgrade_returns_to_the_nullable_shape_then_to_before_projects(tmp_path):
    database = _populated(tmp_path)
    before = _fingerprint(database)
    _upgrade_to(database, REQUIRED)

    _downgrade_to(database, NODE_PROJECTS)
    assert _columns(database, "workspace_nodes")["project_id"] == 0
    assert _fingerprint(database) == before
    assert {(r[2], r[3]) for r in _rows(database, "PRAGMA foreign_key_list(workspace_nodes)")} == {("workspaces", "workspace_id")}

    _downgrade_to(database, DELIVERY_ID)
    assert not {"project_id", "archived_with_project_id"} & set(_columns(database, "workspace_nodes"))
    assert "project_context" not in _columns(database, "agent_sessions")
    assert _rows(database, "SELECT name FROM sqlite_master WHERE name = 'projects'") == []
    assert _fingerprint(database) == before
    assert "ix_workspace_nodes_last_activity_at" in _indexes(database)

    _upgrade_to(database, REQUIRED)
    assert _fingerprint(database) == before
