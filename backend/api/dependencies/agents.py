"""How a request reaches agents: a launcher for probes, a turn service for turns.

Both are dependencies so the suite can install in-memory ones. Production
wiring reaches the ACP client and the process supervisor only here, which
keeps routes and services free of any knowledge of the wire.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from models.agent import AgentRegistrationRecord
from service.agent.contract import Agent, AgentCommand, AgentNegotiationError
from service.agent.registry import Launcher, command_of
from service.agent.sessions import TurnService

__all__ = ["LauncherDep", "TurnServiceDep", "get_launcher", "get_turn_service"]


async def _launch(command: AgentCommand) -> Agent:
    # Imported on use so the API layer does not load the subprocess client
    # merely by being imported.
    from service.agent.acp.agent import AcpAgent

    return await AcpAgent.start(command)


def get_launcher() -> Launcher:
    """A fresh process per probe — never the supervised one a turn is using."""

    return _launch


def get_turn_service(request: Request) -> TurnService:
    """The one turn service of this application, created on first use.

    Held on `app.state` because it tracks turns in progress across requests:
    the cancel route must find the turn the streaming route started.
    """

    state = request.app.state
    service = getattr(state, "turns", None)
    if service is None:
        runtime = state.runtime

        async def provide(profile_id: str, registration: AgentRegistrationRecord) -> Agent:
            if runtime.agents is None:
                raise AgentNegotiationError("Agents are not available: local data is not ready")
            return await runtime.agents.get((profile_id, registration.id), command_of(registration))

        service = TurnService(state.data_dir, provide, context=runtime.context)
        state.turns = service
    return service


LauncherDep = Annotated[Launcher, Depends(get_launcher)]
TurnServiceDep = Annotated[TurnService, Depends(get_turn_service)]
