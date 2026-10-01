"""The contract for a session-stateful conversation backend.

An `Agent` owns its conversation: it is handed only what is new on each turn
and keeps everything before it. That is the difference from
`service/provider/contract.py:Provider`, which is handed the whole transcript
every time and keeps nothing — and it is why the two are separate contracts
rather than one with an adapter hiding the gap. See the change design,
"Two contracts, because the difference is real".

Nothing here names ACP. The ACP client in `service/agent/acp/` is the one
implementation; everything above this module asks for an `Agent` and never
learns which wire it speaks.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

__all__ = [
    "Agent",
    "AgentCommand",
    "McpServer",
    "AgentError",
    "AgentExited",
    "AgentInfo",
    "AgentLaunchError",
    "AgentNegotiationError",
    "AgentNotAuthenticated",
    "AgentTimeout",
    "AuthMethod",
    "Negotiation",
    "PermissionRefused",
    "PlanEntry",
    "PlanUpdate",
    "SessionLoadFailed",
    "TextChunk",
    "ThoughtChunk",
    "ToolActivity",
    "TurnEnded",
    "TurnEvent",
    "TurnOutcome",
    "Usage",
]


# --- Configuration --------------------------------------------------------


@dataclass(frozen=True)
class AgentCommand:
    """How to launch an agent: the learner's command, never a credential."""

    command: str
    args: tuple[str, ...] = ()
    env: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class McpServer:
    """An MCP server handed to an agent for one session: the context server."""

    name: str
    url: str
    headers: tuple[tuple[str, str], ...] = ()


# --- Negotiation ----------------------------------------------------------


@dataclass(frozen=True)
class AgentInfo:
    name: str
    title: str | None = None
    version: str | None = None


@dataclass(frozen=True)
class AuthMethod:
    """How the agent says it can be authenticated — shown as guidance only.

    Nothing in this application acts on one. The learner authenticates through
    the agent's own mechanism (`codex login`, Claude Code's `/login`), and the
    list exists so the workspace can say which.
    """

    id: str
    name: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class Negotiation:
    """What one connection reported at `initialize`, and nothing remembered.

    Re-read on every connection: a stored result from an earlier version of
    the same agent is exactly the assumption the spec forbids.
    """

    protocol_version: int
    info: AgentInfo
    load_session: bool = False
    auth_methods: tuple[AuthMethod, ...] = ()
    capabilities: dict[str, object] = field(default_factory=dict)


# --- Turn events ----------------------------------------------------------

TurnOutcome = Literal["completed", "cancelled", "refused", "failed"]


@dataclass(frozen=True)
class TextChunk:
    text: str


@dataclass(frozen=True)
class ThoughtChunk:
    text: str


@dataclass(frozen=True)
class ToolActivity:
    """A tool the agent invoked, or a later status change to one."""

    tool_call_id: str
    title: str | None = None
    kind: str | None = None
    status: str | None = None


@dataclass(frozen=True)
class PlanEntry:
    content: str
    status: str | None = None


@dataclass(frozen=True)
class PlanUpdate:
    entries: tuple[PlanEntry, ...]


@dataclass(frozen=True)
class PermissionRefused:
    """A permission request answered with a refusal because nothing asked.

    Emitted so the refusal is recorded where the learner can see it — the
    spec's "never silently decided" — until the prompt surface of
    `acp-agent-permissions-and-branching` exists.
    """

    title: str
    tool_call_id: str | None = None


@dataclass(frozen=True)
class Usage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    model: str | None = None


@dataclass(frozen=True)
class TurnEnded:
    """Always the last event of a turn. `reason` explains any non-completion."""

    outcome: TurnOutcome
    reason: str | None = None


TurnEvent = (
    TextChunk | ThoughtChunk | ToolActivity | PlanUpdate | PermissionRefused | Usage | TurnEnded
)


# --- Failures -------------------------------------------------------------


class AgentError(Exception):
    """Base for every failure reaching an agent. `stage` names where it broke."""

    stage: Literal["launch", "negotiate", "authenticate", "session", "turn"] = "turn"


class AgentLaunchError(AgentError):
    stage = "launch"


class AgentNegotiationError(AgentError):
    stage = "negotiate"


class AgentNotAuthenticated(AgentError):
    stage = "authenticate"

    def __init__(self, message: str, auth_methods: tuple[AuthMethod, ...] = ()) -> None:
        super().__init__(message)
        self.auth_methods = auth_methods


class SessionLoadFailed(AgentError):
    stage = "session"


class AgentExited(AgentError):
    """The process ended. Chunks already delivered stand; the turn does not."""


class AgentTimeout(AgentError):
    """The process stopped answering without exiting."""


# --- The contract ---------------------------------------------------------


@runtime_checkable
class Agent(Protocol):
    """A connected, negotiated agent. One per (account, registration)."""

    @property
    def negotiation(self) -> Negotiation: ...

    @property
    def alive(self) -> bool: ...

    async def new_session(self, cwd: Path, mcp_servers: Sequence[McpServer] = ()) -> str:
        """Open a session rooted at `cwd`. Raises `AgentNotAuthenticated`."""

    async def load_session(
        self, session_id: str, cwd: Path, mcp_servers: Sequence[McpServer] = ()
    ) -> None:
        """Resume a session. Only valid when `negotiation.load_session`.

        The history the agent replays while loading is discarded, never
        yielded: the application's transcript already holds it.
        Raises `SessionLoadFailed`.
        """

    def prompt(self, session_id: str, text: str) -> AsyncIterator[TurnEvent]:
        """Send one turn. Always ends with exactly one `TurnEnded`.

        Never raises once iteration starts: an agent that exits or stops
        answering mid-turn ends the turn `failed`, after whatever it had
        already produced.
        """

    async def cancel(self, session_id: str) -> None:
        """Ask the agent to stop; the running `prompt` ends `cancelled`."""

    async def close(self) -> None:
        """Stop the process and everything it started."""
