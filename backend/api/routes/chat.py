"""The streaming turn: a node's conversation, delivered as it is produced.

Server-sent events, as `tech-stack.md` chose: a turn is unidirectional. The
one thing a learner sends back mid-turn — stop — is an ordinary request on
its own route rather than a reason for a WebSocket.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies.agents import TurnServiceDep
from api.dependencies.auth import ActiveProfile, WorkspaceScope
from api.dependencies.runtime import RuntimeDep
from core.exceptions import NotFoundError
from service.agent.sessions import TurnEvent

router = APIRouter(prefix="/chat", tags=["chat"])


class TurnInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    thread_id: str = Field(alias="threadId")
    text: str = Field(min_length=1)
    # `/code`, `/qa`, `/quiz`: ask for practice delivered to that rail tool.
    command: Literal["code", "qa", "quiz"] | None = None


def _sse(event: TurnEvent) -> str:
    name, data = event
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


@router.post("/turn")
async def turn(
    payload: TurnInput,
    _runtime: RuntimeDep,
    profile: ActiveProfile,
    workspace_id: WorkspaceScope,
    turns: TurnServiceDep,
) -> StreamingResponse:
    events = turns.run_turn(
        profile.id, workspace_id, payload.thread_id, payload.text.strip(), command=payload.command
    )
    # The first event is pulled before the response starts, so a thread that
    # does not exist — or belongs to another account — is an ordinary 404
    # rather than a 200 whose stream then fails.
    try:
        first = await anext(events)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))

    async def stream() -> AsyncIterator[str]:
        try:
            yield _sse(first)
            async for event in events:
                yield _sse(event)
        finally:
            await events.aclose()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/turns/{turn_id}/cancel", status_code=204)
async def cancel(turn_id: str, _runtime: RuntimeDep, _profile: ActiveProfile, turns: TurnServiceDep) -> Response:
    # A turn that already ended is not an error: the learner pressed Stop as
    # it finished, and the outcome the stream reported stands.
    await turns.cancel(turn_id)
    return Response(status_code=204)
