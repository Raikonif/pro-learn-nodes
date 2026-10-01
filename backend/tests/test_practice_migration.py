"""The practice migration adds three tables and disturbs nothing already there."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text

from tests.test_profile_migration import WORKSPACE_FOUNDATION, _downgrade_to, _seed_workspace_foundation, _upgrade_to

LOCAL_SESSIONS = "20261001_01"
# Pinned: later revisions add columns to these tables, so this asserts what
# the practice revision itself did rather than the shape at head.
PRACTICE = "20261002_01"


def test_a_populated_database_keeps_every_row(tmp_path: Path):
    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)
    _upgrade_to(database, LOCAL_SESSIONS)

    def snapshot() -> dict:
        engine = create_engine(f"sqlite:///{database}")
        with engine.begin() as connection:
            rows = {
                table: connection.execute(text(f"SELECT * FROM {table} ORDER BY id")).all()
                for table in ("workspace_nodes", "chat_threads", "chat_messages")
            }
        engine.dispose()
        return rows

    before = snapshot()
    _upgrade_to(database, PRACTICE)
    assert snapshot() == before

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        tables = {row[0] for row in connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
    engine.dispose()
    assert {"practice_items", "practice_attempts", "sandbox_buffers"} <= tables

    _downgrade_to(database, LOCAL_SESSIONS)
    assert snapshot() == before
