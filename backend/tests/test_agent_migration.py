"""The agent-backend migration adds, and disturbs nothing already there."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from tests.test_profile_migration import (
    WORKSPACE_FOUNDATION,
    _downgrade_to,
    _seed_workspace_foundation,
    _upgrade_to,
)

BEFORE_AGENTS = "20260825_02"
# Pinned: a later revision moves the thread columns this one adds, so these
# tests assert what *this* revision did rather than the shape at head.
AGENT_BACKENDS = "20260930_01"


def _populated_database_before_agents(tmp_path: Path) -> Path:
    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)
    _upgrade_to(database, BEFORE_AGENTS)
    return database


def test_existing_nodes_have_no_backend_and_messages_are_unchanged(tmp_path: Path):
    database = _populated_database_before_agents(tmp_path)

    _upgrade_to(database, AGENT_BACKENDS)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        node = connection.execute(
            text("SELECT id, backend_agent_id FROM workspace_nodes")
        ).all()
        thread = connection.execute(
            text("SELECT id, agent_id, agent_session_id FROM chat_threads")
        ).all()
        message = connection.execute(
            text("SELECT id, content, kind, outcome FROM chat_messages")
        ).all()
    engine.dispose()

    assert node == [("node-1", None)]
    assert thread == [("thread-1", None, None)]
    assert message == [("message-1", "Learner data survives.", "message", None)]


def test_one_default_agent_per_profile_is_enforced(tmp_path: Path):
    database = _populated_database_before_agents(tmp_path)
    _upgrade_to(database, AGENT_BACKENDS)

    engine = create_engine(f"sqlite:///{database}")
    insert = text(
        "INSERT INTO agent_registrations"
        " (id, profile_id, name, command, args, env, is_default, created_at)"
        " VALUES (:id, (SELECT id FROM profiles LIMIT 1), 'a', 'x', '[]', '{}', :d,"
        " '2026-09-30 10:00:00')"
    )
    with engine.begin() as connection:
        connection.execute(insert, {"id": "a-1", "d": True})
        connection.execute(insert, {"id": "a-2", "d": False})
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(insert, {"id": "a-3", "d": True})
    engine.dispose()


def test_downgrade_returns_the_previous_shape_with_data_intact(tmp_path: Path):
    database = _populated_database_before_agents(tmp_path)
    _upgrade_to(database, AGENT_BACKENDS)

    _downgrade_to(database, BEFORE_AGENTS)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(chat_messages)"))}
        message = connection.execute(text("SELECT id, content FROM chat_messages")).all()
        tables = {row[0] for row in connection.execute(text("SELECT name FROM sqlite_master"))}
    engine.dispose()

    assert "kind" not in columns and "outcome" not in columns
    assert "agent_registrations" not in tables
    assert message == [("message-1", "Learner data survives.")]
