"""Registering agents and testing that one works before a conversation needs it.

A registration is a command. It is launched and negotiated before it is
saved, so a typo is reported at the moment it is made, with the underlying
error, rather than on some later first turn. An agent that launches but is
not signed in *is* saved: it is installed, and signing in is something the
learner does in the agent's own client — nothing here can or should do it
for them.

The launcher is injected. Production passes `AcpAgent.start`; tests pass one
that builds an in-memory `Agent`, so this module's rules are exercised without
a subprocess.
"""

from __future__ import annotations

import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from core.database import session_scope
from core.exceptions import NotFoundError
from models.agent import AgentRegistrationRecord
from repository import agent_repo
from service import workspace
from service.agent.contract import (
    Agent,
    AgentCommand,
    AgentError,
    AgentNotAuthenticated,
)

__all__ = [
    "PRESETS",
    "Launcher",
    "RegistrationRefused",
    "command_of",
    "list_agents",
    "register",
    "remove",
    "serialize",
    "set_default",
    "set_node_backend",
    "test_connection",
    "test_registered",
]

Launcher = Callable[[AgentCommand], Awaitable[Agent]]

# Data for prefilling the settings form — never registered on the learner's
# behalf. Adapter versions are pinned to the ones the spike verified; a newer
# one is a deliberate edit here after the connection test passes against it,
# not something that arrives with the next `npx` run.
PRESETS: list[dict[str, Any]] = [
    {
        "key": "codex",
        "name": "Codex (ChatGPT)",
        "command": "npx",
        "args": ["-y", "@agentclientprotocol/codex-acp@2.0.1"],
        "loginHint": "Run `codex login` in a terminal and choose Sign in with ChatGPT.",
    },
    {
        "key": "claude",
        "name": "Claude Code",
        "command": "npx",
        "args": ["-y", "@agentclientprotocol/claude-agent-acp@0.84.0"],
        "loginHint": "Run `claude` in a terminal and sign in with /login.",
    },
    # No Google preset. Gemini CLI speaks ACP but Google no longer accepts a
    # personal sign-in from it, and Antigravity's `agy` does not speak ACP —
    # see openspec/changes/agy-antigravity-agent. A learner with a Gemini API
    # key can still register Gemini CLI as a custom command.
]


class RegistrationRefused(Exception):
    def __init__(self, stage: str, message: str) -> None:
        super().__init__(message)
        self.stage = stage
        self.message = message


@dataclass(frozen=True)
class _Registration:
    name: str
    command: str
    args: list[str]
    env: dict[str, str]


def command_of(record: AgentRegistrationRecord) -> AgentCommand:
    return AgentCommand(
        command=record.command,
        args=tuple(record.args),
        env=tuple(sorted(record.env.items())),
    )


def serialize(record: AgentRegistrationRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "name": record.name,
        "command": record.command,
        "args": list(record.args),
        "env": dict(record.env),
        "isDefault": record.is_default,
    }


async def test_connection(command: AgentCommand, launch: Launcher) -> dict[str, Any]:
    """Launch, negotiate, and open one session in a throwaway directory.

    Authentication only shows at `session/new` — Claude's adapter advertises
    no auth methods at all and simply refuses the session — so opening one is
    the only test that answers "is it signed in". The directory is a temporary
    one, never a node's, and nothing is recorded: the result creates no node,
    thread, or message.
    """

    result: dict[str, Any] = {
        "ok": False,
        "stage": None,
        "message": None,
        "agent": None,
        "capabilities": None,
        "authMethods": [],
    }
    try:
        agent = await launch(command)
    except AgentError as error:
        result.update(stage=error.stage, message=str(error) or type(error).__name__)
        return result

    negotiation = agent.negotiation
    result["agent"] = {
        "name": negotiation.info.name,
        "title": negotiation.info.title,
        "version": negotiation.info.version,
    }
    result["capabilities"] = {"loadSession": negotiation.load_session}
    result["authMethods"] = [
        {"id": m.id, "name": m.name, "description": m.description}
        for m in negotiation.auth_methods
    ]
    try:
        with tempfile.TemporaryDirectory(prefix="learn-nodes-agent-test-") as scratch:
            await agent.new_session(Path(scratch))
    except AgentNotAuthenticated as error:
        result.update(stage="authenticate", message=str(error) or "The agent is not signed in.")
    except AgentError as error:
        result.update(stage=error.stage, message=str(error) or type(error).__name__)
    else:
        result["ok"] = True
    finally:
        await agent.close()
    return result


def list_agents(profile_id: str) -> dict[str, Any]:
    with session_scope() as session:
        agents = [serialize(r) for r in agent_repo.list_for(session, profile_id)]
    return {"agents": agents, "presets": PRESETS}


async def register(
    profile_id: str,
    *,
    name: str,
    command: str,
    args: list[str],
    env: dict[str, str],
    launch: Launcher,
) -> dict[str, Any]:
    probe = await test_connection(
        AgentCommand(command=command, args=tuple(args), env=tuple(sorted(env.items()))), launch
    )
    if not probe["ok"] and probe["stage"] in {"launch", "negotiate"}:
        raise RegistrationRefused(probe["stage"], probe["message"] or "The agent did not start.")
    with session_scope() as session:
        record = agent_repo.create(
            session, profile_id=profile_id, name=name, command=command, args=args, env=env
        )
        return serialize(record)


async def test_registered(profile_id: str, agent_id: str, launch: Launcher) -> dict[str, Any]:
    with session_scope() as session:
        record = agent_repo.get(session, profile_id, agent_id)
        if record is None:
            raise NotFoundError("Agent not found")
        command = command_of(record)
    return await test_connection(command, launch)


def set_default(profile_id: str, agent_id: str) -> dict[str, Any]:
    with session_scope() as session:
        record = agent_repo.set_default(session, profile_id, agent_id)
        if record is None:
            raise NotFoundError("Agent not found")
        return serialize(record)


def set_node_backend(
    profile_id: str, workspace_id: str, node_id: str, agent_id: str
) -> dict[str, Any]:
    """Point a node at one of this account's agents — never another's."""

    with session_scope() as session:
        if agent_repo.get(session, profile_id, agent_id) is None:
            raise NotFoundError("Agent not found")
    return workspace.set_node_backend(workspace_id, node_id, agent_id)


def remove(profile_id: str, agent_id: str) -> None:
    with session_scope() as session:
        if not agent_repo.remove(session, profile_id, agent_id):
            raise NotFoundError("Agent not found")
