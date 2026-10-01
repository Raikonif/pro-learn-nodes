"""Practice rules: what may be authored, how an answer is recorded.

A learner authoring by hand is the first producer of items; roadmap Phase 12
(and agents, through `agent-shared-context-mcp`) write the same rows through
the same rules here. Answers are append-only: this module records attempts
and offers nothing that edits or removes one.

Branching needs no code here at all: a child's practice is whatever has been
written against the child's own id, which is nothing until the learner works
in it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import logging
import re

from core.database import database_path, session_scope
from core.exceptions import NotFoundError, ValidationError
from models.practice import PracticeAttemptRecord, PracticeItemRecord, SandboxBufferRecord
from models.workspace import WorkspaceNodeRecord
from repository import practice_repo

__all__ = ["author_item", "node_practice", "read_sandbox", "record_attempt", "save_sandbox"]

logger = logging.getLogger(__name__)

KINDS = {"free_response", "multiple_choice", "code_exercise"}
RUN_OUTCOMES = {"completed", "error", "stopped", "timed_out"}
MAX_RUN_OUTPUT = 20_000


def _iso(value: datetime) -> str:
    stamped = value if value.tzinfo else value.replace(tzinfo=UTC)
    return stamped.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _item(item: PracticeItemRecord) -> dict[str, Any]:
    return {
        "id": item.id,
        "nodeId": item.node_id,
        "kind": item.kind,
        "prompt": item.prompt,
        "options": [{"text": o["text"], "correct": bool(o["correct"])} for o in item.options],
        "referenceAnswer": item.reference_answer,
        "starterCode": item.starter_code,
        "expectedOutput": item.expected_output,
        "authoredBy": (
            None
            if item.authored_by_name is None
            else {"agentId": item.authored_by_agent_id, "name": item.authored_by_name}
        ),
        "createdAt": _iso(item.created_at),
    }


def _attempt(attempt: PracticeAttemptRecord) -> dict[str, Any]:
    return {
        "id": attempt.id,
        "itemId": attempt.item_id,
        "nodeId": attempt.node_id,
        "response": attempt.response,
        "chosenOption": attempt.chosen_option,
        "correct": attempt.correct,
        "score": attempt.score,
        "runOutcome": attempt.run_outcome,
        "runOutput": attempt.run_output,
        "createdAt": _iso(attempt.created_at),
    }


def _sandbox(buffer: SandboxBufferRecord | None) -> dict[str, Any]:
    if buffer is None:
        return {"code": "", "updatedAt": None}
    return {"code": buffer.code, "updatedAt": _iso(buffer.updated_at)}


def _require_node(session: Any, workspace_id: str, node_id: str) -> None:
    node = session.get(WorkspaceNodeRecord, node_id)
    if node is None or node.workspace_id != workspace_id:
        raise NotFoundError(f"Unknown node: {node_id}")


def _options(kind: str, raw: Any) -> list[dict[str, Any]]:
    if kind != "multiple_choice":
        return []
    options = [
        {"text": str(o.get("text", "")).strip(), "correct": bool(o.get("correct"))}
        for o in (raw or [])
        if isinstance(o, dict)
    ]
    if len(options) < 2:
        raise ValidationError("A multiple-choice question needs at least two options.")
    if any(not o["text"] for o in options):
        raise ValidationError("An option cannot be empty.")
    if sum(o["correct"] for o in options) != 1:
        raise ValidationError("Mark exactly one option as correct.")
    return options


def author_item(
    workspace_id: str,
    node_id: str,
    fields: dict[str, Any],
    *,
    authored_by: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create an item. `authored_by` is `{agentId, name}` for an agent, None for the learner."""

    kind = fields.get("kind")
    if kind not in KINDS:
        raise ValidationError("An item is a free-response question, a multiple-choice question, or a code exercise.")
    prompt = str(fields.get("prompt") or "").strip()
    if not prompt:
        raise ValidationError("A question needs a prompt.")
    options = _options(kind, fields.get("options"))
    reference = str(fields.get("referenceAnswer") or "").strip() or None
    with session_scope() as session:
        _require_node(session, workspace_id, node_id)
        item = practice_repo.create_item(
            session,
            workspace_id=workspace_id,
            node_id=node_id,
            kind=kind,
            prompt=prompt,
            options=options,
            reference_answer=reference if kind == "free_response" else None,
            starter_code=(fields.get("starterCode") or None) if kind == "code_exercise" else None,
            expected_output=(fields.get("expectedOutput") or None) if kind == "code_exercise" else None,
            authored_by_agent_id=(authored_by or {}).get("agentId"),
            authored_by_name=(authored_by or {}).get("name"),
        )
        serialized = _item(item)
    if kind == "code_exercise":
        _mirror(node_id, serialized, serialized["starterCode"] or "")
    return serialized


def record_attempt(workspace_id: str, item_id: str, answer: dict[str, Any]) -> dict[str, Any]:
    with session_scope() as session:
        item = practice_repo.get_item(session, workspace_id, item_id)
        if item is None:
            raise NotFoundError(f"Unknown practice item: {item_id}")
        if item.kind == "code_exercise":
            outcome = answer.get("runOutcome")
            if outcome not in RUN_OUTCOMES:
                raise ValidationError("Run the code before submitting it.")
            code = str(answer.get("code") or "")
            output = str(answer.get("runOutput") or "")[:MAX_RUN_OUTPUT]
            correct = None
            if item.expected_output is not None:
                # The one judgement computed: did it run, and print what was asked.
                correct = outcome == "completed" and output.rstrip() == item.expected_output.rstrip()
            attempt = practice_repo.insert_attempt(
                session,
                workspace_id=workspace_id,
                node_id=item.node_id,
                item_id=item.id,
                response=code,
                chosen_option=None,
                correct=correct,
                run_outcome=outcome,
                run_output=output,
            )
            return _attempt(attempt)
        if item.kind == "free_response":
            if "chosenOption" in answer and answer["chosenOption"] is not None:
                raise ValidationError("This question takes a written answer.")
            response = str(answer.get("response") or "").strip()
            if not response:
                raise ValidationError("Write an answer before submitting.")
            chosen, correct = None, None
        else:
            if answer.get("response"):
                raise ValidationError("Choose one of the options.")
            chosen = answer.get("chosenOption")
            if not isinstance(chosen, int) or not 0 <= chosen < len(item.options):
                raise ValidationError("Choose one of the options.")
            response, correct = None, bool(item.options[chosen]["correct"])
        attempt = practice_repo.insert_attempt(
            session,
            workspace_id=workspace_id,
            node_id=item.node_id,
            item_id=item.id,
            response=response,
            chosen_option=chosen,
            correct=correct,
        )
        return _attempt(attempt)


def node_practice(workspace_id: str, node_id: str) -> dict[str, Any]:
    with session_scope() as session:
        _require_node(session, workspace_id, node_id)
        return {
            "nodeId": node_id,
            "items": [_item(i) for i in practice_repo.items_for_node(session, workspace_id, node_id)],
            "attempts": [
                _attempt(a) for a in practice_repo.attempts_for_node(session, workspace_id, node_id)
            ],
            "sandbox": _sandbox(practice_repo.sandbox_for_node(session, workspace_id, node_id)),
        }


def _require_exercise(session: Any, workspace_id: str, node_id: str, item_id: str) -> PracticeItemRecord:
    item = practice_repo.get_item(session, workspace_id, item_id)
    if item is None or item.node_id != node_id or item.kind != "code_exercise":
        raise NotFoundError(f"Unknown code exercise: {item_id}")
    return item


def read_sandbox(workspace_id: str, node_id: str, item_id: str | None = None) -> dict[str, Any]:
    """A buffer; an exercise's never-saved buffer reads as its starter code."""

    with session_scope() as session:
        _require_node(session, workspace_id, node_id)
        if item_id is None:
            return _sandbox(practice_repo.sandbox_for_node(session, workspace_id, node_id))
        item = _require_exercise(session, workspace_id, node_id, item_id)
        buffer = practice_repo.sandbox_for_node(session, workspace_id, node_id, item_id)
        if buffer is None:
            return {"code": item.starter_code or "", "updatedAt": None}
        return _sandbox(buffer)


def save_sandbox(
    workspace_id: str, node_id: str, code: str, item_id: str | None = None
) -> dict[str, Any]:
    with session_scope() as session:
        _require_node(session, workspace_id, node_id)
        item = _require_exercise(session, workspace_id, node_id, item_id) if item_id else None
        saved = _sandbox(practice_repo.upsert_sandbox(session, workspace_id, node_id, code, item_id))
        exercise = _item(item) if item is not None else None
    if exercise is not None:
        _mirror(node_id, exercise, code)
    return saved


# --- The file mirror -------------------------------------------------------------


def _slug(text: str) -> str:
    words = re.findall(r"[a-z0-9]+", text.lower())[:6]
    return "-".join(words) or "exercise"


def _mirror(node_id: str, exercise: dict[str, Any], solution: str) -> None:
    """Write an exercise and the learner's solution where the node's agent can read them.

    A projection of the record, never read back: the buffer is the solution,
    and whatever is written to these files from elsewhere is overwritten on
    the learner's next edit. Best effort — a file that cannot be written
    must not fail the learner's save.
    """

    from service.agent.sessions import node_directory

    folder = (
        node_directory(database_path().parent, node_id)
        / "practice"
        / f"{exercise['id'][:8]}-{_slug(exercise['prompt'])}"
    )
    readme = f"# Exercise\n\n{exercise['prompt']}\n"
    if exercise["expectedOutput"] is not None:
        readme += f"\n## Expected output\n\n```\n{exercise['expectedOutput']}\n```\n"
    readme += "\nThe learner's current solution is `solution.py` in this folder.\n"
    try:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "README.md").write_text(readme)
        (folder / "solution.py").write_text(solution)
    except OSError:
        logger.warning("Could not mirror exercise %s for the node's agent", exercise["id"], exc_info=True)
