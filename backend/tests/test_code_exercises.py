"""Code exercises: authored, solved in their own buffer, submitted, mirrored as files."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.database import configure_database, database_path
from core.exceptions import ValidationError
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from service import practice_service as practice
from service import workspace
from service.agent.sessions import node_directory
from service.identity.protocol import Identity
from service.profile_service import ProfileService

AGENT = {"agentId": "agent-1", "name": "Codex"}


@pytest.fixture
def ws(tmp_path: Path) -> str:
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
    return workspace.ensure_default_workspace(profile.id).id


def _node(ws: str) -> str:
    return workspace.create_root_node(ws, "Folds")["graph"]["nodes"][-1]["id"]


def _exercise(ws: str, node: str, **extra) -> dict:
    fields = {"kind": "code_exercise", "prompt": "Sum a list with a fold.", "starterCode": "def total(xs):\n    pass\n", **extra}
    return practice.author_item(ws, node, fields, authored_by=extra.pop("authored_by", None))


# --- Authoring ----------------------------------------------------------------


def test_an_exercise_carries_its_starter_and_expected_output(ws):
    item = _exercise(ws, _node(ws), expectedOutput="6")
    assert (item["kind"], item["starterCode"], item["expectedOutput"], item["authoredBy"]) == (
        "code_exercise", "def total(xs):\n    pass\n", "6", None,
    )


def test_an_exercise_needs_a_statement_but_not_starter_code(ws):
    node = _node(ws)
    with pytest.raises(ValidationError, match="prompt"):
        practice.author_item(ws, node, {"kind": "code_exercise", "prompt": " "})
    bare = practice.author_item(ws, node, {"kind": "code_exercise", "prompt": "Write anything."})
    assert (bare["starterCode"], bare["expectedOutput"]) == (None, None)


def test_an_agent_authored_item_names_its_author(ws):
    item = practice.author_item(ws, _node(ws), {"kind": "free_response", "prompt": "Why?"}, authored_by=AGENT)
    assert item["authoredBy"] == {"agentId": "agent-1", "name": "Codex"}


# --- Buffers ------------------------------------------------------------------------


def test_an_exercise_buffer_starts_from_starter_code_and_is_its_own(ws):
    node = _node(ws)
    first, second = _exercise(ws, node), _exercise(ws, node, starterCode="# second\n")

    assert practice.read_sandbox(ws, node, first["id"]) == {"code": "def total(xs):\n    pass\n", "updatedAt": None}
    practice.save_sandbox(ws, node, "def total(xs):\n    return sum(xs)\n", item_id=first["id"])
    practice.save_sandbox(ws, node, "print('free')")

    assert practice.read_sandbox(ws, node, first["id"])["code"] == "def total(xs):\n    return sum(xs)\n"
    assert practice.read_sandbox(ws, node, second["id"])["code"] == "# second\n"
    assert practice.node_practice(ws, node)["sandbox"]["code"] == "print('free')"


def test_a_buffer_for_an_item_of_another_node_is_not_found(ws):
    from core.exceptions import NotFoundError

    node, other = _node(ws), _node(ws)
    item = _exercise(ws, node)
    with pytest.raises(NotFoundError):
        practice.read_sandbox(ws, other, item["id"])
    with pytest.raises(NotFoundError):
        practice.save_sandbox(ws, other, "x", item_id=item["id"])


# --- Submitting ------------------------------------------------------------------------


def test_submitting_records_code_outcome_and_output(ws):
    item = _exercise(ws, _node(ws))
    attempt = practice.record_attempt(ws, item["id"], {"code": "print(6)", "runOutcome": "completed", "runOutput": "6\n"})
    assert (attempt["response"], attempt["runOutcome"], attempt["runOutput"], attempt["correct"], attempt["score"]) == (
        "print(6)", "completed", "6\n", None, None,
    )


@pytest.mark.parametrize(
    ("outcome", "output", "correct"),
    [("completed", "6\n", True), ("completed", "6   \n\n", True), ("completed", "7\n", False), ("error", "6\n", False)],
)
def test_the_expected_output_is_the_only_judgement(ws, outcome, output, correct):
    item = _exercise(ws, _node(ws), expectedOutput="6")
    attempt = practice.record_attempt(ws, item["id"], {"code": "x", "runOutcome": outcome, "runOutput": output})
    assert attempt["correct"] is correct


def test_submissions_are_appended_and_output_is_bounded(ws):
    item = _exercise(ws, _node(ws))
    practice.record_attempt(ws, item["id"], {"code": "first", "runOutcome": "error", "runOutput": "boom"})
    big = practice.record_attempt(ws, item["id"], {"code": "second", "runOutcome": "completed", "runOutput": "x" * 50_000})

    assert len(big["runOutput"]) <= 20_000
    attempts = practice.node_practice(ws, item["nodeId"])["attempts"]
    assert [a["response"] for a in attempts] == ["second", "first"]


def test_an_unknown_run_outcome_is_refused(ws):
    item = _exercise(ws, _node(ws))
    with pytest.raises(ValidationError):
        practice.record_attempt(ws, item["id"], {"code": "x", "runOutcome": "graded", "runOutput": ""})


# --- The file mirror ---------------------------------------------------------------------


def _mirror(tmp_path: Path, node: str, item: dict) -> Path:
    [folder] = (node_directory(tmp_path, node) / "practice").iterdir()
    assert folder.name.startswith(item["id"][:8])
    return folder


def test_an_exercise_and_its_solution_are_files_the_agent_can_read(ws, tmp_path):
    node = _node(ws)
    item = _exercise(ws, node, expectedOutput="6")
    folder = _mirror(tmp_path, node, item)

    assert "Sum a list with a fold." in (folder / "README.md").read_text()
    assert "6" in (folder / "README.md").read_text()
    assert (folder / "solution.py").read_text() == "def total(xs):\n    pass\n"

    practice.save_sandbox(ws, node, "def total(xs):\n    return sum(xs)\n", item_id=item["id"])
    assert (folder / "solution.py").read_text() == "def total(xs):\n    return sum(xs)\n"


def test_the_file_is_a_mirror_never_read_back(ws, tmp_path):
    node = _node(ws)
    item = _exercise(ws, node)
    folder = _mirror(tmp_path, node, item)
    practice.save_sandbox(ws, node, "learner's code", item_id=item["id"])

    (folder / "solution.py").write_text("an agent's 'fix'")

    assert practice.read_sandbox(ws, node, item["id"])["code"] == "learner's code"
    practice.save_sandbox(ws, node, "learner's next edit", item_id=item["id"])
    assert (folder / "solution.py").read_text() == "learner's next edit"


def test_no_other_nodes_directory_is_written(ws, tmp_path):
    node, other = _node(ws), _node(ws)
    _exercise(ws, node)
    assert not (node_directory(tmp_path, other) / "practice").exists()
