"""Shared memory: agents propose, the learner decides, accepted memory is recalled.

Covers every scenario of `specs/shared-memory/spec.md`.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from core.database import configure_database, database_path, session_scope
from core.exceptions import NotFoundError, ValidationError
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.memory import MemoryRecord
from service import memory_service, workspace
from service.identity.protocol import Identity
from service.profile_service import ProfileService


@pytest.fixture
def profiles(tmp_path: Path) -> tuple[str, str]:
    configure_database(tmp_path)
    migrate_database(database_path())
    service = ProfileService(InMemorySecretStore())
    ada = service.enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
    grace = service.enroll(Identity(provider="dev", subject="grace", display_name="Grace"))
    return ada.id, grace.id


def _node(profile_id: str, title: str) -> str:
    created = workspace.create_root_node(workspace.ensure_default_workspace(profile_id).id, title)
    return max(created["graph"]["nodes"], key=lambda n: n["createdAt"])["id"]


def _propose(profile_id: str, text: str, *, topic: str | None = None, by: str = "Codex", node: str | None = None) -> dict:
    return memory_service.propose(
        profile_id, text=text, topic=topic, proposed_by_name=by, source_node_id=node
    )


def _recalled(profile_id: str, **kwargs) -> list[str]:
    return [m["text"] for m in memory_service.recall(profile_id, **kwargs)["memories"]]


# --- proposals ---------------------------------------------------------------


def test_a_proposal_awaits_the_learner_and_is_not_recalled(profiles):
    ada, _ = profiles
    node = _node(ada, "Haskell laziness")
    memory = _propose(ada, "  Knows Haskell is lazy  ", topic=" Haskell Laziness ", node=node)

    assert memory["text"] == "Knows Haskell is lazy"
    assert memory["topic"] == "haskell-laziness"
    assert memory["status"] == "pending"
    assert (memory["proposedBy"], memory["sourceNodeId"], memory["sourceTitle"]) == ("Codex", node, "Haskell laziness")
    assert memory["revises"] is None and memory["history"] == [] and memory["decidedAt"] is None

    listing = memory_service.list_for_learner(ada)
    assert [m["id"] for m in listing["pending"]] == [memory["id"]]
    assert listing["accepted"] == []
    assert memory_service.recall(ada) == {"memories": [], "truncated": False}


def test_an_empty_proposal_is_refused(profiles):
    ada, _ = profiles
    with pytest.raises(ValidationError):
        _propose(ada, "   ")


def test_an_empty_topic_is_no_topic(profiles):
    ada, _ = profiles
    assert _propose(ada, "Fact", topic="   ")["topic"] is None


def test_a_source_node_of_another_account_has_no_title(profiles):
    ada, grace = profiles
    theirs = _node(grace, "Grace's")
    assert _propose(ada, "Fact", node=theirs)["sourceTitle"] is None
    assert _propose(ada, "Fact", node="gone")["sourceTitle"] is None


# --- the learner decides -------------------------------------------------------


def test_accepting_makes_it_recalled(profiles):
    ada, _ = profiles
    memory = _propose(ada, "Knows folds")
    accepted = memory_service.accept(ada, memory["id"], None)

    assert accepted["status"] == "accepted" and accepted["decidedAt"] is not None
    assert _recalled(ada) == ["Knows folds"]
    listing = memory_service.list_for_learner(ada)
    assert listing["pending"] == [] and [m["id"] for m in listing["accepted"]] == [memory["id"]]


def test_accepting_with_an_edit_is_what_agents_receive(profiles):
    ada, _ = profiles
    memory = _propose(ada, "Knows folds")
    memory_service.accept(ada, memory["id"], "  Knows foldr and foldl  ")
    assert _recalled(ada) == ["Knows foldr and foldl"]


def test_accepting_with_an_empty_edit_is_refused(profiles):
    ada, _ = profiles
    memory = _propose(ada, "Knows folds")
    with pytest.raises(ValidationError):
        memory_service.accept(ada, memory["id"], "  ")
    assert _recalled(ada) == []


def test_a_rejected_proposal_is_never_recalled_but_kept(profiles):
    ada, _ = profiles
    memory = _propose(ada, "Knows monads")
    rejected = memory_service.reject(ada, memory["id"])

    assert rejected["status"] == "rejected"
    assert _recalled(ada) == []
    assert memory_service.list_for_learner(ada) == {"pending": [], "accepted": []}
    with session_scope() as session:
        assert session.get(MemoryRecord, memory["id"]).status == "rejected"
    with pytest.raises(ValidationError):
        memory_service.accept(ada, memory["id"], None)


def test_removing_an_accepted_memory_stops_recall(profiles):
    ada, _ = profiles
    memory = _propose(ada, "Knows folds")
    memory_service.accept(ada, memory["id"], None)
    memory_service.remove(ada, memory["id"])

    assert _recalled(ada) == []
    assert memory_service.list_for_learner(ada)["accepted"] == []
    with session_scope() as session:
        assert session.get(MemoryRecord, memory["id"]).status == "removed"


def test_only_pending_can_be_rejected_and_only_accepted_removed_or_edited(profiles):
    ada, _ = profiles
    memory = _propose(ada, "Knows folds")
    with pytest.raises(ValidationError):
        memory_service.remove(ada, memory["id"])
    with pytest.raises(ValidationError):
        memory_service.edit(ada, memory["id"], "x")
    memory_service.accept(ada, memory["id"], None)
    with pytest.raises(ValidationError):
        memory_service.reject(ada, memory["id"])
    with pytest.raises(ValidationError):
        memory_service.accept(ada, memory["id"], None)


def test_editing_an_accepted_memory_keeps_its_old_text_in_history(profiles):
    ada, _ = profiles
    memory = _propose(ada, "Knows folds", topic="folds")
    memory_service.accept(ada, memory["id"], None)
    edited = memory_service.edit(ada, memory["id"], "Knows foldr deeply")

    assert edited["id"] != memory["id"]
    assert (edited["text"], edited["status"], edited["proposedBy"], edited["topic"]) == ("Knows foldr deeply", "accepted", "You", "folds")
    assert [h["text"] for h in edited["history"]] == ["Knows folds"]
    assert _recalled(ada) == ["Knows foldr deeply"]
    with pytest.raises(ValidationError):
        memory_service.edit(ada, edited["id"], " ")


# --- sharing and isolation -------------------------------------------------------


def test_accepted_memory_reaches_other_agents_and_sessions(profiles):
    ada, _ = profiles
    one, two = _node(ada, "Session one"), _node(ada, "Session two")
    a = _propose(ada, "Knows folds", by="Codex", node=one)
    b = _propose(ada, "Knows recursion", by="Claude", node=two)
    memory_service.accept(ada, a["id"], None)
    memory_service.accept(ada, b["id"], None)

    recalled = memory_service.recall(ada)["memories"]
    assert {(m["text"], m["proposedBy"]) for m in recalled} == {("Knows folds", "Codex"), ("Knows recursion", "Claude")}
    assert set(recalled[0]) == {"id", "text", "topic", "proposedBy", "decidedAt"}


def test_memory_stays_within_the_account(profiles):
    ada, grace = profiles
    memory = _propose(ada, "Knows folds")
    memory_service.accept(ada, memory["id"], None)

    assert _recalled(grace) == []
    assert memory_service.list_for_learner(grace) == {"pending": [], "accepted": []}
    assert "Knows folds" not in memory_service.export_markdown(grace)
    for operation in (
        lambda: memory_service.accept(grace, memory["id"], None),
        lambda: memory_service.reject(grace, memory["id"]),
        lambda: memory_service.edit(grace, memory["id"], "x"),
        lambda: memory_service.remove(grace, memory["id"]),
        lambda: memory_service.remove(ada, "no-such-memory"),
    ):
        with pytest.raises(NotFoundError):
            operation()


# --- recall ------------------------------------------------------------------------


def test_recall_filters_by_topic_and_query(profiles):
    ada, _ = profiles
    for text, topic in [("Knows Haskell is lazy", "haskell-laziness"), ("Writes Python daily", None), ("Understands lazy lists in Python", "python")]:
        memory_service.accept(ada, _propose(ada, text, topic=topic)["id"], None)

    assert _recalled(ada, topic="Haskell Laziness") == ["Knows Haskell is lazy"]
    assert sorted(_recalled(ada, query="LAZY")) == ["Knows Haskell is lazy", "Understands lazy lists in Python"]
    assert _recalled(ada, query="lazy python") == ["Understands lazy lists in Python"]
    assert _recalled(ada, query="haskell-laz") == ["Knows Haskell is lazy"]  # topic matches too
    assert _recalled(ada, query="python", topic="python") == ["Understands lazy lists in Python"]
    assert _recalled(ada, query="rust") == []


def test_recall_is_newest_decided_first_and_bounded(profiles):
    ada, _ = profiles
    for i in range(3):
        memory_service.accept(ada, _propose(ada, f"Fact {i}")["id"], None)

    assert _recalled(ada) == ["Fact 2", "Fact 1", "Fact 0"]
    limited = memory_service.recall(ada, limit=2)
    assert [m["text"] for m in limited["memories"]] == ["Fact 2", "Fact 1"] and limited["truncated"] is True
    assert memory_service.recall(ada, limit=3)["truncated"] is False


def test_recall_caps_the_limit_and_long_texts(profiles):
    ada, _ = profiles
    memory_service.accept(ada, _propose(ada, "x" * 600)["id"], None)
    recalled = memory_service.recall(ada, limit=500)
    text = recalled["memories"][0]["text"]
    assert len(text) == 501 and text.endswith("…") and recalled["truncated"] is True

    for i in range(55):
        with session_scope() as session:
            session.add(MemoryRecord(profile_id=ada, text=f"F{i}", status="accepted", proposed_by_name="Codex"))
    assert len(memory_service.recall(ada, limit=500)["memories"]) == 50


# --- topics and revisions ---------------------------------------------------------------


def _accepted_on(profile_id: str, text: str, topic: str) -> dict:
    return memory_service.accept(profile_id, _propose(profile_id, text, topic=topic)["id"], None)


def test_a_proposal_on_a_known_topic_is_a_revision(profiles):
    ada, _ = profiles
    current = _accepted_on(ada, "Knows Haskell is lazy", "haskell-laziness")
    revision = _propose(ada, "Understands thunks and deferred evaluation", topic="Haskell laziness", by="Claude")

    assert revision["status"] == "pending"
    assert revision["revises"] == {"id": current["id"], "text": "Knows Haskell is lazy"}
    assert _recalled(ada) == ["Knows Haskell is lazy"]


def test_accepting_a_revision_supersedes_and_keeps_history(profiles):
    ada, _ = profiles
    current = _accepted_on(ada, "Knows Haskell is lazy", "haskell-laziness")
    revision = _propose(ada, "Understands thunks", topic="haskell-laziness")
    accepted = memory_service.accept(ada, revision["id"], None)

    assert _recalled(ada) == ["Understands thunks"]
    assert accepted["status"] == "accepted" and accepted["revises"] is None
    assert [h["text"] for h in accepted["history"]] == ["Knows Haskell is lazy"]
    assert accepted["history"][0]["decidedAt"] is not None
    with session_scope() as session:
        assert session.get(MemoryRecord, current["id"]).status == "superseded"

    third = memory_service.accept(ada, _propose(ada, "Uses seq and bang patterns", topic="haskell-laziness")["id"], None)
    assert [h["text"] for h in third["history"]] == ["Knows Haskell is lazy", "Understands thunks"]
    listing = memory_service.list_for_learner(ada)
    assert [m["text"] for m in listing["accepted"]] == ["Uses seq and bang patterns"]


def test_rejecting_a_revision_changes_nothing(profiles):
    ada, _ = profiles
    _accepted_on(ada, "Knows Haskell is lazy", "haskell-laziness")
    revision = _propose(ada, "Wrong idea", topic="haskell-laziness")
    memory_service.reject(ada, revision["id"])
    assert _recalled(ada) == ["Knows Haskell is lazy"]


def test_a_proposal_that_raced_an_acceptance_is_accepted_as_a_revision(profiles):
    ada, _ = profiles
    first = _propose(ada, "First", topic="t")
    second = _propose(ada, "Second", topic="t")  # both plain: nothing accepted yet
    assert second["revises"] is None
    memory_service.accept(ada, first["id"], None)
    accepted = memory_service.accept(ada, second["id"], None)

    assert _recalled(ada) == ["Second"]
    assert [h["text"] for h in accepted["history"]] == ["First"]


def test_a_revision_of_a_removed_memory_is_accepted_plain(profiles):
    ada, _ = profiles
    current = _accepted_on(ada, "Old", "t")
    revision = _propose(ada, "New", topic="t")
    memory_service.remove(ada, current["id"])
    accepted = memory_service.accept(ada, revision["id"], None)

    assert _recalled(ada) == ["New"]
    assert accepted["history"] == []


def test_the_database_holds_one_accepted_memory_per_topic(profiles):
    ada, _ = profiles
    _accepted_on(ada, "Old", "t")
    with pytest.raises(IntegrityError):
        with session_scope() as session:
            session.add(MemoryRecord(profile_id=ada, text="Dup", topic="t", status="accepted", proposed_by_name="X"))
    with session_scope() as session:
        rows = session.exec(select(MemoryRecord).where(MemoryRecord.topic == "t", MemoryRecord.status == "accepted")).all()
    assert len(rows) == 1


# --- export ------------------------------------------------------------------------------


def test_export_lists_every_accepted_memory_with_its_source(profiles):
    ada, _ = profiles
    node = _node(ada, "Folds session")
    memory_service.accept(ada, _propose(ada, "Knows folds", topic="folds", node=node)["id"], None)
    memory_service.accept(ada, _propose(ada, "Writes Python")["id"], None)
    _propose(ada, "Pending fact")
    memory_service.reject(ada, _propose(ada, "Rejected fact")["id"])

    markdown = memory_service.export_markdown(ada)
    assert markdown.startswith("# Memory")
    assert "- Knows folds" in markdown and "`folds`" in markdown and "Folds session" in markdown
    assert "- Writes Python" in markdown
    assert "Pending fact" not in markdown and "Rejected fact" not in markdown
