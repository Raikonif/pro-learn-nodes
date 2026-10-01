"""Wire shapes for the ACP subset this application speaks — and nothing more.

`initialize`, `session/new`, `session/load`, `session/prompt`,
`session/cancel`, `session/update`, and `session/request_permission`. That
subset is small and stable, which is why the client is our own rather than
the 0.x SDK (see the change design, "ACP lives in Python ... a thin client of
our own").

Every model ignores fields it does not name, and an update whose
`sessionUpdate` kind is unknown parses to `None` rather than failing: a newer
agent adding a field or an update kind must never break a turn.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from pydantic.alias_generators import to_camel

PROTOCOL_VERSION = 1

# JSON-RPC error codes the client produces or recognises.
METHOD_NOT_FOUND = -32601
AUTH_REQUIRED = -32000


class WireModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="ignore", frozen=True
    )

    def dump(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)


# --- initialize -----------------------------------------------------------


class FileSystemCapability(WireModel):
    read_text_file: bool = False
    write_text_file: bool = False


class ClientCapabilities(WireModel):
    # Advertised as absent on purpose: agents read inside their working
    # directory with their own tools, and nothing here serves files.
    fs: FileSystemCapability = FileSystemCapability()
    terminal: bool = False


class InitializeParams(WireModel):
    protocol_version: int = PROTOCOL_VERSION
    client_capabilities: ClientCapabilities = ClientCapabilities()

    def dump(self) -> dict[str, Any]:
        # `exclude_none` would be harmless, but the `False` flags must stay.
        return self.model_dump(by_alias=True)


class Implementation(WireModel):
    name: str
    title: str | None = None
    version: str | None = None


class AuthMethodWire(WireModel):
    id: str
    name: str | None = None
    description: str | None = None


class AgentCapabilities(WireModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="allow", frozen=True
    )

    load_session: bool = False


class InitializeResult(WireModel):
    protocol_version: int
    agent_capabilities: AgentCapabilities = AgentCapabilities()
    agent_info: Implementation | None = None
    auth_methods: list[AuthMethodWire] = []


# --- sessions -------------------------------------------------------------


class NewSessionParams(WireModel):
    cwd: str
    mcp_servers: list[dict[str, Any]] = []

    def dump(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class NewSessionResult(WireModel):
    session_id: str


class LoadSessionParams(WireModel):
    session_id: str
    cwd: str
    mcp_servers: list[dict[str, Any]] = []

    def dump(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class TextContent(WireModel):
    type: Literal["text"] = "text"
    text: str


class PromptParams(WireModel):
    session_id: str
    prompt: list[TextContent]


class UsageWire(WireModel):
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


StopReason = str  # end_turn | max_tokens | max_turn_requests | refusal | cancelled


class PromptResult(WireModel):
    stop_reason: StopReason
    usage: UsageWire | None = None


class CancelParams(WireModel):
    session_id: str


# --- session/update -------------------------------------------------------


class ContentBlock(WireModel):
    """Any content block. Only text is rendered; other types carry no text."""

    type: str
    text: str | None = None


class MessageChunk(WireModel):
    session_update: Literal["agent_message_chunk"]
    content: ContentBlock


class ThoughtChunkWire(WireModel):
    session_update: Literal["agent_thought_chunk"]
    content: ContentBlock


class ToolCall(WireModel):
    session_update: Literal["tool_call", "tool_call_update"]
    tool_call_id: str
    title: str | None = None
    kind: str | None = None
    status: str | None = None


class PlanEntryWire(WireModel):
    content: str
    status: str | None = None


class Plan(WireModel):
    session_update: Literal["plan"]
    entries: list[PlanEntryWire] = []


KnownUpdate = Annotated[
    MessageChunk | ThoughtChunkWire | ToolCall | Plan,
    Field(discriminator="session_update"),
]
_known_update: TypeAdapter[KnownUpdate] = TypeAdapter(KnownUpdate)
_KNOWN_KINDS = frozenset(
    {"agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan"}
)


class SessionNotification(WireModel):
    session_id: str
    update: dict[str, Any]


def parse_update(update: dict[str, Any]) -> KnownUpdate | None:
    """The update as a known model, or `None` for a kind this client ignores.

    `usage_update`, `available_commands_update`, `session_info_update`,
    `user_message_chunk`, and anything a later protocol adds are all `None`.
    A known kind that fails validation is also `None`: one malformed update
    loses one update, not the turn.
    """

    if update.get("sessionUpdate") not in _KNOWN_KINDS:
        return None
    try:
        return _known_update.validate_python(update)
    except ValidationError:
        return None


# --- session/request_permission -------------------------------------------


class PermissionToolCall(WireModel):
    tool_call_id: str | None = None
    title: str | None = None
    kind: str | None = None


class RequestPermissionParams(WireModel):
    session_id: str
    tool_call: PermissionToolCall = PermissionToolCall()


CANCELLED_PERMISSION: dict[str, Any] = {"outcome": {"outcome": "cancelled"}}
