"""The local-sessions migration: activity, titles, archive, per-agent sessions, search.

Built from a populated database at the `acp-agent-backend` head, so every
assertion is about data that existed before the revision ran rather than a
fresh install that would pass even if `upgrade()` recreated every table.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text

from core.migrations import migrate_database
from tests.test_profile_migration import (
    WORKSPACE_FOUNDATION,
    _downgrade_to,
    _seed_workspace_foundation,
    _upgrade_to,
)

AGENT_BACKENDS = "20260930_01"


def _populated_at_agent_backends(tmp_path: Path) -> Path:
    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)
    _upgrade_to(database, AGENT_BACKENDS)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE chat_threads SET agent_id = 'agent-1', agent_session_id = 'sess-1'"
                " WHERE id = 'thread-1'"
            )
        )
        connection.execute(
            text(
                "INSERT INTO chat_messages (id, workspace_id, thread_id, role, content,"
                " kind, created_at) VALUES ('message-2', 'ws-1', 'thread-1', 'learner',"
                " 'Tell me about recursion schemes', 'message', '2026-09-01 12:00:00')"
            )
        )
    engine.dispose()
    return database


def _rows(database: Path, sql: str) -> list[tuple]:
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        rows = [tuple(row) for row in connection.execute(text(sql)).all()]
    engine.dispose()
    return rows


def test_nodes_gain_activity_title_source_and_archive_state(tmp_path: Path):
    database = _populated_at_agent_backends(tmp_path)

    migrate_database(database)

    [(activity, title_source, archived)] = _rows(
        database, "SELECT last_activity_at, title_source, archived_at FROM workspace_nodes"
    )
    # The later of last_opened_at (2026-08-21) and the newest message (2026-09-01).
    assert str(activity).startswith("2026-09-01 12:00:00")
    assert title_source == "topic"
    assert archived is None


def test_a_threads_agent_session_moves_into_agent_sessions(tmp_path: Path):
    database = _populated_at_agent_backends(tmp_path)

    migrate_database(database)

    assert _rows(database, "SELECT thread_id, agent_id, session_id, synced_through FROM agent_sessions") == [
        ("thread-1", "agent-1", "sess-1", "2026-09-01 12:00:00")
    ]
    columns = {row[1] for row in _rows(database, "PRAGMA table_info(chat_threads)")}
    assert "agent_id" not in columns and "agent_session_id" not in columns


def test_existing_messages_are_searchable_and_new_ones_indexed(tmp_path: Path):
    database = _populated_at_agent_backends(tmp_path)
    migrate_database(database)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO chat_messages (id, workspace_id, thread_id, role, content, kind,"
                " created_at) VALUES ('message-3', 'ws-1', 'thread-1', 'agent',"
                " 'Catamorphisms fold a structure', 'message', '2026-09-02 12:00:00')"
            )
        )
        connection.execute(
            text("UPDATE chat_messages SET content = 'Anamorphisms unfold' WHERE id = 'message-3'")
        )
        connection.execute(
            text(
                "INSERT INTO chat_messages (id, workspace_id, thread_id, role, content, kind,"
                " created_at) VALUES ('tool-1', 'ws-1', 'thread-1', 'agent',"
                " 'Read recursion.md', 'tool', '2026-09-02 12:00:01')"
            )
        )
        found = lambda q: [  # noqa: E731
            row[0]
            for row in connection.execute(
                text("SELECT message_id FROM message_fts WHERE message_fts MATCH :q"), {"q": q}
            )
        ]
        assert found('"recursion" AND "schemes"') == ["message-2"]
        assert found('"anamorphisms"') == ["message-3"]
        assert found('"catamorphisms"') == [], "an update replaces the indexed text"
        assert found('"read"') == [], "tool activity is not conversation"
    engine.dispose()


def test_dropping_thread_columns_keeps_its_keys_and_partial_index(tmp_path: Path):
    """Compared with the schema before, not with an assumed one.

    The columns are dropped in place rather than by a rebuild, so the foreign
    keys and the partial unique index on `chat_threads` must come through
    exactly as they were.
    """

    database = _populated_at_agent_backends(tmp_path)
    keys = "SELECT \"table\", \"from\", \"to\" FROM pragma_foreign_key_list('{}') ORDER BY 1, 2"
    before = {t: _rows(database, keys.format(t)) for t in ("chat_threads", "chat_messages")}

    migrate_database(database)

    assert {t: _rows(database, keys.format(t)) for t in before} == before
    assert "chat_threads" in {row[2] for row in _rows(database, "PRAGMA foreign_key_list(agent_sessions)")}
    [(index_sql,)] = _rows(
        database, "SELECT sql FROM sqlite_master WHERE name = 'uq_main_thread_per_node'"
    )
    assert "WHERE anchor_id IS NULL" in index_sql
    assert _rows(database, "PRAGMA foreign_key_check") == []


def test_downgrade_restores_one_session_per_thread(tmp_path: Path):
    database = _populated_at_agent_backends(tmp_path)
    migrate_database(database)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO agent_sessions (id, thread_id, agent_id, session_id, synced_through)"
                " VALUES ('as-2', 'thread-1', 'agent-2', 'sess-2', '2026-09-05 00:00:00')"
            )
        )
    engine.dispose()

    _downgrade_to(database, AGENT_BACKENDS)

    assert _rows(database, "SELECT id, agent_id, agent_session_id FROM chat_threads") == [
        ("thread-1", "agent-2", "sess-2")
    ]
    assert _rows(database, "SELECT id FROM chat_messages ORDER BY id") == [("message-1",), ("message-2",)]
    tables = {row[0] for row in _rows(database, "SELECT name FROM sqlite_master")}
    assert "agent_sessions" not in tables and "message_fts" not in tables
