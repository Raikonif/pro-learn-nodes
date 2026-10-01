"""The agent-context migration: existing practice keeps its meaning."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from core.migrations import migrate_database
from tests.test_profile_migration import WORKSPACE_FOUNDATION, _downgrade_to, _seed_workspace_foundation, _upgrade_to

PRACTICE = "20261002_01"


def _populated(tmp_path: Path) -> Path:
    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)
    _upgrade_to(database, PRACTICE)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        c.execute(text("INSERT INTO practice_items (id, workspace_id, node_id, kind, prompt, options, created_at)"
                       " VALUES ('item-1', 'ws-1', 'node-1', 'free_response', 'Q?', '[]', '2026-10-01 10:00:00')"))
        c.execute(text("INSERT INTO sandbox_buffers (id, workspace_id, node_id, code, updated_at)"
                       " VALUES ('buf-1', 'ws-1', 'node-1', 'print(1)', '2026-10-01 10:00:00')"))
    engine.dispose()
    return database


def _rows(database: Path, sql: str) -> list[tuple]:
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        rows = [tuple(r) for r in c.execute(text(sql))]
    engine.dispose()
    return rows


def test_existing_items_are_the_learners_and_buffers_are_free_buffers(tmp_path):
    database = _populated(tmp_path)
    migrate_database(database)

    assert _rows(database, "SELECT id, authored_by_name, starter_code FROM practice_items") == [("item-1", None, None)]
    assert _rows(database, "SELECT id, node_id, item_id, code FROM sandbox_buffers") == [("buf-1", "node-1", None, "print(1)")]
    assert _rows(database, "SELECT data FROM chat_messages") == [(None,)]


def test_one_free_buffer_and_one_buffer_per_exercise(tmp_path):
    database = _populated(tmp_path)
    migrate_database(database)
    engine = create_engine(f"sqlite:///{database}")
    insert = text("INSERT INTO sandbox_buffers (id, workspace_id, node_id, item_id, code, updated_at)"
                  " VALUES (:id, 'ws-1', 'node-1', :item, '', '2026-10-01 10:00:00')")
    with engine.begin() as c:
        c.execute(insert, {"id": "buf-2", "item": "item-1"})
    for duplicate in ({"id": "buf-3", "item": None}, {"id": "buf-4", "item": "item-1"}):
        with pytest.raises(IntegrityError):
            with engine.begin() as c:
                c.execute(insert, duplicate)
    engine.dispose()


def test_downgrade_keeps_the_free_buffer(tmp_path):
    database = _populated(tmp_path)
    migrate_database(database)
    _downgrade_to(database, PRACTICE)

    assert _rows(database, "SELECT id, code FROM sandbox_buffers") == [("buf-1", "print(1)")]
    tables = {r[0] for r in _rows(database, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "memories" not in tables
