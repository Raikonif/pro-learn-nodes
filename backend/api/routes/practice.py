"""Practice routes: a node's questions, answers, and sandbox code.

The workspace comes from the account dependency, never from the caller; a
node or item of another account is answered as one that does not exist.
There is no route that edits or removes an attempt — answering again is a
new attempt.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies.auth import WorkspaceScope
from api.dependencies.runtime import RuntimeDep
from core.exceptions import NotFoundError, ValidationError
from service import practice_service

router = APIRouter(prefix="/practice", tags=["practice"])


class InputModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class OptionInput(InputModel):
    text: str
    correct: bool = False


class ItemInput(InputModel):
    kind: Literal["free_response", "multiple_choice", "code_exercise"]
    prompt: str
    options: list[OptionInput] = Field(default_factory=list)
    reference_answer: str | None = Field(default=None, alias="referenceAnswer")
    starter_code: str | None = Field(default=None, alias="starterCode")
    expected_output: str | None = Field(default=None, alias="expectedOutput")


class AttemptInput(InputModel):
    response: str | None = None
    chosen_option: int | None = Field(default=None, alias="chosenOption")
    # A code exercise's submission: the code, and how running it went.
    code: str | None = None
    run_outcome: str | None = Field(default=None, alias="runOutcome")
    run_output: str | None = Field(default=None, alias="runOutput")


class SandboxInput(InputModel):
    # Code only: a run's output never leaves the WebView.
    model_config = ConfigDict(extra="forbid")
    code: str


def _domain_error(error: Exception) -> HTTPException:
    if isinstance(error, NotFoundError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, ValidationError):
        return HTTPException(status_code=422, detail=str(error))
    raise error


@router.get("/nodes/{node_id}")
async def node_practice(node_id: str, _runtime: RuntimeDep, workspace_id: WorkspaceScope) -> dict[str, Any]:
    try:
        return practice_service.node_practice(workspace_id, node_id)
    except Exception as error:
        raise _domain_error(error)


@router.post("/nodes/{node_id}/items")
async def author_item(
    node_id: str, payload: ItemInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    fields = {
        "kind": payload.kind,
        "prompt": payload.prompt,
        "options": [option.model_dump() for option in payload.options],
        "referenceAnswer": payload.reference_answer,
        "starterCode": payload.starter_code,
        "expectedOutput": payload.expected_output,
    }
    try:
        return practice_service.author_item(workspace_id, node_id, fields)
    except Exception as error:
        raise _domain_error(error)


@router.post("/items/{item_id}/attempts")
async def record_attempt(
    item_id: str, payload: AttemptInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    answer = {
        "response": payload.response,
        "chosenOption": payload.chosen_option,
        "code": payload.code,
        "runOutcome": payload.run_outcome,
        "runOutput": payload.run_output,
    }
    try:
        return practice_service.record_attempt(workspace_id, item_id, answer)
    except Exception as error:
        raise _domain_error(error)


@router.get("/nodes/{node_id}/sandbox")
async def read_sandbox(
    node_id: str,
    _runtime: RuntimeDep,
    workspace_id: WorkspaceScope,
    item_id: Annotated[str | None, Query(alias="itemId")] = None,
) -> dict[str, Any]:
    try:
        return practice_service.read_sandbox(workspace_id, node_id, item_id)
    except Exception as error:
        raise _domain_error(error)


@router.put("/nodes/{node_id}/sandbox")
async def save_sandbox(
    node_id: str,
    payload: SandboxInput,
    _runtime: RuntimeDep,
    workspace_id: WorkspaceScope,
    item_id: Annotated[str | None, Query(alias="itemId")] = None,
) -> dict[str, Any]:
    try:
        return practice_service.save_sandbox(workspace_id, node_id, payload.code, item_id)
    except Exception as error:
        raise _domain_error(error)
