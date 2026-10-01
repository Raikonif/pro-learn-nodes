"""Adoption of a workspace that predates accounts, driven through Alembic.

Adoption is a migration rather than startup code, so these tests exercise it
the only way it actually runs: by upgrading a database built at the revision
that introduced the nullable owner column. Building at head instead would
assert nothing — a fresh database has no pre-account rows to adopt.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from core.migrations import migrate_database

# The revision that added `profiles` and the nullable `workspaces.profile_id`.
# Pinned rather than resolved from head so that a later revision cannot quietly
# turn these upgrade tests into fresh-install tests.
NULLABLE_OWNER = "20260824_01"

# The identity adoption claims. Asserted here rather than imported from the
# migration because it is a contract, not an implementation detail: changing it
# after a release would enroll a second account and orphan the graph the first
# one owns, so a test that moved with the migration would protect nothing.
ADOPTED_PROVIDER = "local"
ADOPTED_SUBJECT = "adopted-workspace"

# The eight tables carrying a foreign key to `workspaces`. Making
# `profile_id` non-nullable rebuilds that table under SQLite, and a rebuild is
# where a child's reference silently starts pointing at nothing.
WORKSPACE_CHILD_FOREIGN_KEYS = {
    "workspace_contexts": {("workspaces", "workspace_id", "id")},
    "workspace_nodes": {("workspaces", "workspace_id", "id")},
    "selection_anchors": {
        ("workspaces", "workspace_id", "id"),
        ("chat_messages", "source_message_id", "id"),
    },
    "node_links": {
        ("workspaces", "workspace_id", "id"),
        ("workspace_nodes", "parent_id", "id"),
        ("workspace_nodes", "child_id", "id"),
        ("selection_anchors", "anchor_id", "id"),
    },
    "chat_threads": {
        ("workspaces", "workspace_id", "id"),
        ("workspace_nodes", "node_id", "id"),
    },
    "chat_messages": {
        ("workspaces", "workspace_id", "id"),
        ("chat_threads", "thread_id", "id"),
    },
    "sources": {("workspaces", "workspace_id", "id")},
    "source_chunks": {
        ("workspaces", "workspace_id", "id"),
        ("sources", "source_id", "id"),
    },
}


def _alembic_config(database: Path) -> Config:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    return config


def _upgrade_to(database: Path, revision: str) -> None:
    command.upgrade(_alembic_config(database), revision)


def _downgrade_to(database: Path, revision: str) -> None:
    command.downgrade(_alembic_config(database), revision)


def _seed_unowned_workspace(database: Path) -> None:
    """Populate the shape an upgrading learner actually has on disk.

    Every table named in the adoption scenario is represented, including the
    `chat_messages → selection_anchors → node_links` chain: adoption backfills
    one column, but the rebuild that follows it copies the whole table, and a
    child row lost there is a lost branch in the learner's graph.
    """

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO workspaces (id, revision, created_at, profile_id)"
                " VALUES ('ws-1', 12, '2026-08-21 10:00:00', NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO workspace_contexts (id, workspace_id, last_open_node_id, viewport)"
                " VALUES ('ctx-1', 'ws-1', 'node-1', '{\"x\": 3}')"
            )
        )
        for node_id, title in (("node-1", "Root node"), ("node-2", "Branched node")):
            connection.execute(
                text(
                    "INSERT INTO workspace_nodes"
                    " (id, workspace_id, title, mode, body, active_skills, mcp_servers,"
                    "  created_at, last_opened_at)"
                    f" VALUES ('{node_id}', 'ws-1', '{title}', 'Explore', 'body of {node_id}',"
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
        connection.execute(
            text(
                "INSERT INTO selection_anchors"
                " (id, workspace_id, source_message_id, start_offset, end_offset, excerpt)"
                " VALUES ('anchor-1', 'ws-1', 'message-1', 0, 7, 'Learner')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO node_links (id, workspace_id, parent_id, child_id, anchor_id)"
                " VALUES ('link-1', 'ws-1', 'node-1', 'node-2', 'anchor-1')"
            )
        )
    engine.dispose()


def _query(database: Path, statement: str) -> list[tuple]:
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        rows = connection.execute(text(statement)).all()
    engine.dispose()
    return [tuple(row) for row in rows]


def test_an_existing_workspace_is_adopted_with_every_row_intact(tmp_path: Path):
    """The upgrade scenario, end to end, in a single `migrate_database` call.

    That it completes at all is half the assertion: the non-nullable revision
    runs in the same upgrade, so an adoption that failed to backfill would
    abort here rather than merely leave the workspace unowned.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, NULLABLE_OWNER)
    _seed_unowned_workspace(database)

    migrate_database(database)

    profiles = _query(database, "SELECT id, provider, subject FROM profiles")
    assert len(profiles) == 1
    profile_id, provider, subject = profiles[0]
    assert (provider, subject) == (ADOPTED_PROVIDER, ADOPTED_SUBJECT)

    assert _query(database, "SELECT id, revision, profile_id FROM workspaces") == [
        ("ws-1", 12, profile_id)
    ]
    # Joined rather than counted: a rebuild that renumbered or detached a row
    # would still satisfy a count, and "the same nodes, links, threads,
    # messages, and anchors" is a statement about relationships.
    assert _query(
        database,
        "SELECT n.id, n.title, n.body FROM workspace_nodes n"
        " JOIN workspaces w ON w.id = n.workspace_id ORDER BY n.id",
    ) == [
        ("node-1", "Root node", "body of node-1"),
        ("node-2", "Branched node", "body of node-2"),
    ]
    assert _query(
        database,
        "SELECT l.id, p.title, c.title, a.excerpt FROM node_links l"
        " JOIN workspace_nodes p ON p.id = l.parent_id"
        " JOIN workspace_nodes c ON c.id = l.child_id"
        " JOIN selection_anchors a ON a.id = l.anchor_id",
    ) == [("link-1", "Root node", "Branched node", "Learner")]
    assert _query(
        database,
        "SELECT t.id, t.name, m.content FROM chat_threads t"
        " JOIN chat_messages m ON m.thread_id = t.id",
    ) == [("thread-1", "main", "Learner data survives.")]
    assert _query(
        database,
        "SELECT a.id, m.id FROM selection_anchors a"
        " JOIN chat_messages m ON m.id = a.source_message_id",
    ) == [("anchor-1", "message-1")]
    assert _query(
        database, "SELECT id, last_open_node_id FROM workspace_contexts"
    ) == [("ctx-1", "node-1")]


def test_adoption_happens_only_once(tmp_path: Path):
    """Alembic's version table gives this, but the spec requires the property.

    Asserted on the rows rather than on the version table so that it keeps
    holding if adoption is ever reached by another route.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, NULLABLE_OWNER)
    _seed_unowned_workspace(database)
    migrate_database(database)

    before = _query(database, "SELECT id, provider, subject FROM profiles")
    migrate_database(database)

    assert _query(database, "SELECT id, provider, subject FROM profiles") == before
    assert _query(database, "SELECT id, profile_id FROM workspaces") == [
        ("ws-1", before[0][0])
    ]


def test_a_fresh_install_gains_no_phantom_account(tmp_path: Path):
    """Adoption must be conditional on there being something to adopt.

    An unconditional insert would hand every new installation an account
    nobody signed in to, which the sign-in gate would then have to explain.
    """

    database = tmp_path / "workspace.sqlite3"
    migrate_database(database)

    assert _query(database, "SELECT id FROM profiles") == []
    assert _query(database, "SELECT id FROM workspaces") == []


def test_adoption_reuses_a_local_profile_that_already_exists(tmp_path: Path):
    """`uq_profile_identity` makes a blind insert a hard upgrade failure.

    A learner who reached a `local` profile by any other route would otherwise
    be unable to upgrade at all, with the constraint violation surfacing as a
    crash on launch.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, NULLABLE_OWNER)
    _seed_unowned_workspace(database)
    # Enrolled under exactly the identity adoption claims, so the two collide
    # on `uq_profile_identity` unless the migration looks before it inserts.
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO profiles (id, provider, subject, created_at)"
                " VALUES ('pre-existing', :provider, :subject, '2026-08-24 09:00:00')"
            ),
            {"provider": ADOPTED_PROVIDER, "subject": ADOPTED_SUBJECT},
        )
    engine.dispose()

    migrate_database(database)

    assert _query(database, "SELECT id FROM profiles") == [("pre-existing",)]
    assert _query(database, "SELECT id, profile_id FROM workspaces") == [
        ("ws-1", "pre-existing")
    ]


def test_the_owner_column_is_required_after_the_upgrade(tmp_path: Path):
    """Asserted by insertion, not by reading the schema.

    `PRAGMA table_info` would report the declared shape of a column the
    database does not actually refuse to leave empty.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, NULLABLE_OWNER)
    _seed_unowned_workspace(database)
    migrate_database(database)

    engine = create_engine(f"sqlite:///{database}")
    with pytest.raises(IntegrityError, match="NOT NULL"):
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO workspaces (id, revision, created_at, profile_id)"
                    " VALUES ('ws-unowned', 0, '2026-08-25 10:00:00', NULL)"
                )
            )
    engine.dispose()


def test_the_owner_column_is_still_a_foreign_key_after_the_rebuild(tmp_path: Path):
    """The non-nullable step copies `workspaces` through a new definition.

    SQLite has no `ALTER COLUMN`, so the constraint survives only if the
    rebuild re-declares it; a batch operation that lost it would leave
    `profile_id` a required but unconstrained string.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, NULLABLE_OWNER)
    _seed_unowned_workspace(database)
    migrate_database(database)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        owner_keys = {
            (row[2], row[3], row[4])
            for row in connection.execute(text("PRAGMA foreign_key_list(workspaces)"))
        }
    assert owner_keys == {("profiles", "profile_id", "id")}
    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys = ON"))
            connection.execute(
                text(
                    "INSERT INTO workspaces (id, revision, created_at, profile_id)"
                    " VALUES ('ws-orphan', 0, '2026-08-25 10:00:00', 'no-such-profile')"
                )
            )
    engine.dispose()


@pytest.mark.parametrize("child", sorted(WORKSPACE_CHILD_FOREIGN_KEYS))
def test_every_child_foreign_key_survives_the_rebuild(child: str, tmp_path: Path):
    """Rebuilding a parent is where children quietly lose their references.

    SQLite rewrites foreign keys in other tables when a table is renamed, and
    Alembic's batch mode renames twice. A previous rebuild in this project
    preserved them, which is a reason to re-prove the property, not to assume
    it — an unenforced reference is invisible until a delete corrupts data.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, NULLABLE_OWNER)
    _seed_unowned_workspace(database)
    migrate_database(database)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        keys = {
            (row[2], row[3], row[4])
            for row in connection.execute(text(f"PRAGMA foreign_key_list({child})"))
        }
    engine.dispose()

    assert keys == WORKSPACE_CHILD_FOREIGN_KEYS[child]


def test_the_migrated_database_has_no_broken_references(tmp_path: Path):
    """Declared constraints are one half; the rows satisfying them are the other."""

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, NULLABLE_OWNER)
    _seed_unowned_workspace(database)
    migrate_database(database)

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        violations = connection.execute(text("PRAGMA foreign_key_check")).all()
    engine.dispose()

    assert violations == []


def test_downgrading_returns_the_unowned_shape_with_data_intact(tmp_path: Path):
    """The two-step sequence has to be reversible in both of its steps.

    Restoring the timestamped backup is the documented rollback, but a
    `downgrade()` that raises would strand anyone who reaches for it first.
    """

    database = tmp_path / "workspace.sqlite3"
    _upgrade_to(database, NULLABLE_OWNER)
    _seed_unowned_workspace(database)
    migrate_database(database)

    _downgrade_to(database, NULLABLE_OWNER)

    assert _query(database, "SELECT id FROM profiles") == []
    assert _query(database, "SELECT id, profile_id FROM workspaces") == [("ws-1", None)]
    assert _query(database, "SELECT id, content FROM chat_messages") == [
        ("message-1", "Learner data survives.")
    ]
    assert _query(database, "SELECT id, parent_id, child_id FROM node_links") == [
        ("link-1", "node-1", "node-2")
    ]
    notnull = {
        row[1]: row[3] for row in _query(database, "PRAGMA table_info(workspaces)")
    }
    assert notnull["profile_id"] == 0
