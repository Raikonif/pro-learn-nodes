"""The remembered-permissions migration: one new table, nothing existing touched."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from tests.test_profile_migration import WORKSPACE_FOUNDATION, _downgrade_to, _seed_workspace_foundation, _upgrade_to

PROJECTS_REQUIRED = "20261006_03"
PERMISSIONS = "20261007_01"


def _rows(database: Path, sql: str) -> list[tuple]:
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        rows = [tuple(r) for r in c.execute(text(sql))]
    engine.dispose()
    return rows


def _at_projects(tmp_path: Path) -> Path:
    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)
    _upgrade_to(database, PROJECTS_REQUIRED)
    return database


_INSERT = text(
    "INSERT INTO permission_decisions (id, workspace_id, node_id, agent_id, kind, allow, created_at)"
    " VALUES (:id, 'ws-1', 'node-1', 'agent-1', 'edit', 1, '2026-10-07 10:00:00')"
)


def test_the_table_is_added_empty_and_nodes_are_untouched(tmp_path):
    database = _at_projects(tmp_path)
    nodes_before = _rows(database, "SELECT * FROM workspace_nodes ORDER BY id")
    _upgrade_to(database, PERMISSIONS)

    assert _rows(database, "SELECT COUNT(*) FROM permission_decisions") == [(0,)]
    assert _rows(database, "SELECT * FROM workspace_nodes ORDER BY id") == nodes_before
    indexes = {r[0] for r in _rows(database, "SELECT name FROM sqlite_master WHERE type='index'")}
    assert "ix_permission_decisions_workspace_id" in indexes


def test_one_decision_per_workspace_node_agent_and_kind(tmp_path):
    database = _at_projects(tmp_path)
    _upgrade_to(database, PERMISSIONS)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        c.execute(_INSERT, {"id": "d1"})
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(_INSERT, {"id": "d2"})
    engine.dispose()


def test_downgrade_drops_the_table(tmp_path):
    database = _at_projects(tmp_path)
    _upgrade_to(database, PERMISSIONS)
    _downgrade_to(database, PROJECTS_REQUIRED)

    tables = {r[0] for r in _rows(database, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "permission_decisions" not in tables
    assert _rows(database, "SELECT id FROM workspace_nodes") == [("node-1",)]
