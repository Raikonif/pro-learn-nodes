from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from core.migrations import migrate_database

WORKSPACE_FOUNDATION = "20260821_01"


def _upgrade_to(database: Path, revision: str) -> None:
    """Build a database at a historical revision.

    `migrate_database` deliberately only goes to head, so a test that needs the
    *pre-upgrade* shape has to drive Alembic itself. Pinning the revision here
    is what makes this an upgrade test rather than a fresh-install test: build
    at head and the assertions would pass even if `upgrade()` dropped and
    recreated every table.
    """

    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, revision)


def _downgrade_to(database: Path, revision: str) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.downgrade(config, revision)


def _seed_workspace_foundation(database: Path) -> None:
    """Populate a pre-account database with one workspace and a conversation."""

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO workspaces (id, revision, created_at)"
                " VALUES ('ws-1', 7, '2026-08-21 10:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO workspace_nodes"
                " (id, workspace_id, title, mode, body, active_skills, mcp_servers,"
                "  created_at, last_opened_at)"
                " VALUES ('node-1', 'ws-1', 'Existing node', 'Explore', 'body text',"
                " '[]', '[]', '2026-08-21 10:00:00', '2026-08-21 10:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO chat_threads (id, workspace_id, node_id, name, anchor_id)"
                " VALUES ('thread-1', 'ws-1', 'node-1', 'main', NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO chat_messages"
                " (id, workspace_id, thread_id, role, content, created_at)"
                " VALUES ('message-1', 'ws-1', 'thread-1', 'agent', 'Learner data survives.',"
                " '2026-08-21 10:00:00')"
            )
        )
    engine.dispose()


def test_upgrading_a_populated_database_preserves_every_row(tmp_path: Path):
    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)

    migrate_database(database)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        workspace = connection.execute(
            text("SELECT id, revision, profile_id FROM workspaces")
        ).all()
        node = connection.execute(text("SELECT id, title, body FROM workspace_nodes")).all()
        thread = connection.execute(text("SELECT id, node_id, name FROM chat_threads")).all()
        message = connection.execute(text("SELECT id, thread_id, content FROM chat_messages")).all()
        local_profile_id = connection.execute(
            text("SELECT id FROM profiles WHERE provider = 'local'")
        ).scalar_one()
    engine.dispose()

    # `profile_id` arrives NULL and is adopted on the way to head. What matters
    # here is that migrating did not disturb the row: the id and revision are
    # untouched, and the owner it gained is the `local` profile the adoption
    # migration enrols rather than an arbitrary one.
    assert [(row[0], row[1]) for row in workspace] == [("ws-1", 7)]
    assert workspace[0][2] == local_profile_id, "workspace was not adopted by the local profile"

    assert node == [("node-1", "Existing node", "body text")]
    assert thread == [("thread-1", "node-1", "main")]
    assert message == [("message-1", "thread-1", "Learner data survives.")]


def test_the_upgrade_keeps_the_partial_main_thread_index_enforceable(tmp_path: Path):
    """`batch_alter_table` rebuilds `workspaces`; nothing else may be lost.

    SQLite has no `ALTER TABLE ADD CONSTRAINT`, so Alembic's batch mode copies
    the table. The `chat_threads` partial unique index is defined in raw SQL
    that Alembic cannot reflect, which is exactly the kind of thing a careless
    batch operation on the wrong table would silently drop.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    migrate_database(database)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        indexes = connection.execute(
            text("SELECT name FROM sqlite_master WHERE type = 'index'")
        ).scalars().all()
        tables = connection.execute(
            text("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
        ).scalars().all()
    engine.dispose()

    assert "uq_main_thread_per_node" in indexes
    assert "uq_profile_identity" in indexes
    assert "ix_workspaces_profile_id" in indexes
    assert "profiles" in tables
    assert "source_chunk_fts" in tables


def test_the_workspace_owner_column_is_a_real_foreign_key(tmp_path: Path):
    """A plain `ADD COLUMN` would leave `profile_id` an unconstrained string.

    Asserting on the schema text would pass on a column the database does not
    actually enforce, so this asserts on enforcement instead — with the same
    `PRAGMA foreign_keys = ON` the application engine sets.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    migrate_database(database)

    engine = create_engine(f"sqlite:///{database}")
    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys = ON"))
            connection.execute(
                text(
                    "INSERT INTO workspaces (id, revision, created_at, profile_id)"
                    " VALUES ('ws-orphan', 0, '2026-08-24 10:00:00', 'no-such-profile')"
                )
            )
    engine.dispose()


def test_downgrading_returns_the_pre_account_shape_with_data_intact(tmp_path: Path):
    """The rollback path in the Migration Plan has to actually run.

    Restoring the timestamped backup is the documented recovery, but a
    `downgrade()` that raises would strand anyone who reaches for it first.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, WORKSPACE_FOUNDATION)
    _seed_workspace_foundation(database)
    migrate_database(database)

    _downgrade_to(database, WORKSPACE_FOUNDATION)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        tables = connection.execute(
            text("SELECT name FROM sqlite_master WHERE type = 'table'")
        ).scalars().all()
        columns = connection.execute(text("PRAGMA table_info(workspaces)")).all()
        workspace = connection.execute(text("SELECT id, revision FROM workspaces")).all()
        message = connection.execute(text("SELECT id, content FROM chat_messages")).all()
    engine.dispose()

    assert "profiles" not in tables
    assert "profile_id" not in {column[1] for column in columns}
    assert workspace == [("ws-1", 7)]
    assert message == [("message-1", "Learner data survives.")]
