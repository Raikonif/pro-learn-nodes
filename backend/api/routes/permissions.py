"""Answering an agent's permission requests, and the decisions a learner kept.

The streaming turn announces a request; the answer arrives here, as its own
request, so the stream stays one-way (the change design, "The prompt lives
in two places"). Every route is scoped by the active account: another
account's request or decision is answered exactly as one that does not exist.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlmodel import select

from api.dependencies.agents import TurnServiceDep
from api.dependencies.auth import ActiveProfile, WorkspaceScope
from api.dependencies.runtime import RuntimeDep
from core.database import session_scope
from core.exceptions import NotFoundError
from models.agent import AgentRegistrationRecord
from models.workspace import WorkspaceNodeRecord
from repository import permission_repo
from service.agent.permissions import AlreadyDecided

router = APIRouter(prefix="/permissions", tags=["permissions"])

_REMOVED_AGENT = "a removed agent"


class Decision(BaseModel):
    allow: bool
    remember: bool = False


@router.get("/pending")
async def pending(
    _runtime: RuntimeDep, _profile: ActiveProfile, workspace_id: WorkspaceScope, turns: TurnServiceDep
) -> list[dict[str, Any]]:
    return [entry.describe() for entry in turns.permissions.pending(workspace_id)]


@router.post("/pending/{request_id}", status_code=204)
async def decide(
    request_id: str,
    payload: Decision,
    _runtime: RuntimeDep,
    _profile: ActiveProfile,
    workspace_id: WorkspaceScope,
    turns: TurnServiceDep,
) -> Response:
    try:
        turns.permissions.decide(workspace_id, request_id, payload.allow, payload.remember)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except AlreadyDecided as error:
        raise HTTPException(status_code=409, detail=str(error))
    return Response(status_code=204)


@router.get("/remembered")
async def remembered(
    _runtime: RuntimeDep, profile: ActiveProfile, workspace_id: WorkspaceScope
) -> list[dict[str, Any]]:
    with session_scope() as session:
        decisions = permission_repo.list_for(session, workspace_id)
        titles = dict(
            session.exec(
                select(WorkspaceNodeRecord.id, WorkspaceNodeRecord.title).where(
                    WorkspaceNodeRecord.workspace_id == workspace_id
                )
            ).all()
        )
        agents = dict(
            session.exec(
                select(AgentRegistrationRecord.id, AgentRegistrationRecord.name).where(
                    AgentRegistrationRecord.profile_id == profile.id
                )
            ).all()
        )
        return [
            {
                "id": decision.id,
                "nodeId": decision.node_id,
                "nodeTitle": titles.get(decision.node_id, ""),
                "agentId": decision.agent_id,
                "agentName": agents.get(decision.agent_id, _REMOVED_AGENT),
                "kind": decision.kind,
                "allow": decision.allow,
                "createdAt": decision.created_at.isoformat(),
            }
            for decision in decisions
        ]


@router.delete("/remembered/{decision_id}", status_code=204)
async def revoke(
    decision_id: str, _runtime: RuntimeDep, _profile: ActiveProfile, workspace_id: WorkspaceScope
) -> Response:
    with session_scope() as session:
        if not permission_repo.revoke(session, workspace_id, decision_id):
            raise HTTPException(status_code=404, detail="Unknown remembered decision")
    return Response(status_code=204)
