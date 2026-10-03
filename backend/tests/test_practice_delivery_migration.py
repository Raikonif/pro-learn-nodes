"""The delivery-id migration: agent items learn which delivery brought them."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import create_engine, text

from tests.test_profile_migration import WORKSPACE_FOUNDATION, _downgrade_to, _seed_workspace_foundation, _upgrade_to

SESSION_CONTROLS = "20261004_01"
DELIVERY_ID = "20261005_01"


def _populated(tmp_path: Path) -> Path:
    """Two quiz deliveries, one item each, and one item the learner wrote."""

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)
    _upgrade_to(database, SESSION_CONTROLS)
    engine = create_engine(f"sqlite:///{database}")
    item = text("INSERT INTO practice_items (id, workspace_id, node_id, kind, prompt, options, authored_by_name, created_at)"
                " VALUES (:id, 'ws-1', 'node-1', 'multiple_choice', 'Q?', '[]', :author, '2026-10-01 10:00:00')")
    message = text("INSERT INTO chat_messages (id, workspace_id, thread_id, role, content, kind, data, created_at)"
                   " VALUES (:id, 'ws-1', 'thread-1', 'agent', 'Codex sent a question to Quiz', :kind, :data,"
                   " '2026-10-01 10:00:00')")
    with engine.begin() as c:
        for id_, author in (("item-1", "Codex"), ("item-2", "Codex"), ("mine", None)):
            c.execute(item, {"id": id_, "author": author})
        c.execute(message, {"id": "delivery-1", "kind": "practice_delivered",
                            "data": json.dumps({"tool": "quiz", "itemIds": ["item-1"]})})
        c.execute(message, {"id": "delivery-2", "kind": "practice_delivered",
                            "data": json.dumps({"tool": "quiz", "itemIds": ["item-2"]})})
        # A notice that names the item must not be mistaken for its delivery.
        c.execute(message, {"id": "notice", "kind": "practice_not_delivered",
                            "data": json.dumps({"tool": "quiz", "itemIds": ["mine"]})})
    engine.dispose()
    return database


def _rows(database: Path, sql: str) -> list[tuple]:
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        rows = [tuple(r) for r in c.execute(text(sql))]
    engine.dispose()
    return rows


def test_delivered_items_name_their_delivery_and_the_learners_stay_null(tmp_path):
    database = _populated(tmp_path)
    assert "delivery_id" not in {r[1] for r in _rows(database, "PRAGMA table_info(practice_items)")}
    _upgrade_to(database, DELIVERY_ID)

    assert _rows(database, "SELECT id, delivery_id FROM practice_items ORDER BY id") == [
        ("item-1", "delivery-1"), ("item-2", "delivery-2"), ("mine", None),
    ]
    indexes = {r[0] for r in _rows(database, "SELECT name FROM sqlite_master WHERE type='index'")}
    assert "ix_practice_items_delivery_id" in indexes


def test_downgrade_drops_the_column_and_keeps_the_items(tmp_path):
    database = _populated(tmp_path)
    _upgrade_to(database, DELIVERY_ID)
    _downgrade_to(database, SESSION_CONTROLS)

    columns = {r[1] for r in _rows(database, "PRAGMA table_info(practice_items)")}
    assert "delivery_id" not in columns
    assert _rows(database, "SELECT id FROM practice_items ORDER BY id") == [("item-1",), ("item-2",), ("mine",)]
    indexes = {r[0] for r in _rows(database, "SELECT name FROM sqlite_master WHERE type='index'")}
    assert "ix_practice_items_delivery_id" not in indexes
