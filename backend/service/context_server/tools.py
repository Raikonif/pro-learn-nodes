"""The context server's tools: read progressively, add, never change or remove.

Every tool resolves its scope from its own request's credential. Reads reach
the account's unarchived sessions; writes reach only the credential's own
session (no tool takes a session id to write to). The exact set is fixed by a
test — adding one that updates or removes has to change that test first.
"""

from __future__ import annotations

from typing import Any

from mcp.server.mcpserver import Context, MCPServer

from core.exceptions import NotFoundError, ValidationError
from service import practice_service, workspace
from service.context_server.credentials import CredentialRegistry, Scope
from service.context_server.delivery import TOOL_OF_KIND, Delivery, DeliveryBus

__all__ = ["TOOL_NAMES", "register_tools"]

TOOL_NAMES = frozenset({
    "current_session", "list_sessions", "search_sessions", "read_session", "get_messages",
    "get_practice", "recall_memory",
    "add_question", "add_code_exercise", "propose_memory", "set_session_title",
})


def register_tools(mcp: MCPServer, credentials: CredentialRegistry, deliveries: DeliveryBus) -> None:
    def scope(ctx: Context) -> Scope:
        from service.context_server.app import scope_of

        return scope_of(ctx, credentials)

    def refuse(error: Exception) -> dict[str, Any]:
        # Not found and refused read the same to the agent as to an HTTP caller:
        # a reason, and no data. Another account's id is simply not found.
        if isinstance(error, NotFoundError):
            return {"error": "Not found."}
        if isinstance(error, ValidationError):
            return {"error": str(error)}
        raise error

    def deliver(s: Scope, item: dict[str, Any]) -> None:
        deliveries.publish(Delivery(s.node_id, s.thread_id, TOOL_OF_KIND[item["kind"]], (item["id"],), s.agent_name))

    # --- Read -----------------------------------------------------------------

    @mcp.tool(description="The session you are working in: its title and mode, and your own name.")
    async def current_session(ctx: Context) -> dict[str, Any]:
        s = scope(ctx)
        try:
            outline = workspace.session_outline(s.workspace_id, s.node_id)
        except Exception as error:
            return refuse(error)
        return {**outline["session"], "you": s.agent_name}

    @mcp.tool(description="The learner's sessions, most recently active first (titles only). Use search_sessions to find one by content.")
    async def list_sessions(ctx: Context, limit: int = 20) -> dict[str, Any]:
        return workspace.session_summaries(scope(ctx).workspace_id, limit)

    @mcp.tool(description="Search the learner's sessions by what was said in them. Returns previews; use read_session and get_messages for more.")
    async def search_sessions(ctx: Context, query: str) -> dict[str, Any]:
        return workspace.search_sessions(scope(ctx).workspace_id, query)

    @mcp.tool(description="An outline of a session's conversation: newest messages first, each shortened, one page at a time. Pass `cursor` from `next` for the following page.")
    async def read_session(ctx: Context, session_id: str, cursor: str | None = None) -> dict[str, Any]:
        try:
            offset = int(cursor) if cursor else 0
        except ValueError:
            return {"error": "Invalid cursor."}
        try:
            return workspace.session_outline(scope(ctx).workspace_id, session_id, offset)
        except Exception as error:
            return refuse(error)

    @mcp.tool(description="The full text of up to 10 messages, by the ids read_session or search_sessions returned.")
    async def get_messages(ctx: Context, message_ids: list[str]) -> dict[str, Any]:
        return workspace.messages_by_ids(scope(ctx).workspace_id, message_ids)

    @mcp.tool(description="A session's practice: questions, code exercises (with who wrote them), the learner's attempts, and code. Defaults to your session.")
    async def get_practice(ctx: Context, session_id: str | None = None) -> dict[str, Any]:
        s = scope(ctx)
        try:
            return practice_service.node_practice(s.workspace_id, session_id or s.node_id)
        except Exception as error:
            return refuse(error)

    @mcp.tool(description="Facts the learner has accepted as things they know. Optionally filter by text or by topic.")
    async def recall_memory(ctx: Context, query: str | None = None, topic: str | None = None) -> dict[str, Any]:
        from service import memory_service

        return memory_service.recall(scope(ctx).profile_id, query=query, topic=topic)

    # --- Add ------------------------------------------------------------------

    @mcp.tool(description="Add a question to the learner's practice in this session: kind 'free_response' (shown in Q&A) or 'multiple_choice' (shown in Quiz, options as [{text, correct}] with exactly one correct). Use this instead of writing questions in the conversation.")
    async def add_question(
        ctx: Context,
        prompt: str,
        kind: str = "free_response",
        options: list[dict[str, Any]] | None = None,
        reference_answer: str | None = None,
    ) -> dict[str, Any]:
        s = scope(ctx)
        if kind not in ("free_response", "multiple_choice"):
            return {"error": "kind is 'free_response' or 'multiple_choice'; use add_code_exercise for code."}
        try:
            item = practice_service.author_item(
                s.workspace_id, s.node_id,
                {"kind": kind, "prompt": prompt, "options": options or [], "referenceAnswer": reference_answer},
                authored_by={"agentId": s.agent_id, "name": s.agent_name},
            )
        except Exception as error:
            return refuse(error)
        deliver(s, item)
        return {"added": item["id"], "shownIn": "Q&A" if kind == "free_response" else "Quiz"}

    @mcp.tool(description="Add a code exercise for the learner to solve in the app's Code panel: a statement, starter code, and optionally the exact output a correct program prints. Use this instead of writing the exercise in the conversation.")
    async def add_code_exercise(
        ctx: Context, prompt: str, starter_code: str = "", expected_output: str | None = None
    ) -> dict[str, Any]:
        s = scope(ctx)
        try:
            item = practice_service.author_item(
                s.workspace_id, s.node_id,
                {"kind": "code_exercise", "prompt": prompt, "starterCode": starter_code, "expectedOutput": expected_output},
                authored_by={"agentId": s.agent_id, "name": s.agent_name},
            )
        except Exception as error:
            return refuse(error)
        deliver(s, item)
        return {"added": item["id"], "shownIn": "Code"}

    @mcp.tool(description="Propose a short fact the learner now knows. It is kept only if the learner accepts it. Give a stable topic (e.g. 'haskell/laziness') so a later proposal on the same topic revises it.")
    async def propose_memory(ctx: Context, fact: str, topic: str | None = None) -> dict[str, Any]:
        from service import memory_service

        s = scope(ctx)
        try:
            memory = memory_service.propose(
                s.profile_id, text=fact, topic=topic, proposed_by_name=s.agent_name, source_node_id=s.node_id
            )
        except Exception as error:
            return refuse(error)
        return {"proposed": memory["id"], "isRevision": memory.get("revises") is not None,
                "status": "pending: the learner decides"}

    @mcp.tool(description="Title your session, if the learner has not chosen a title.")
    async def set_session_title(ctx: Context, title: str) -> dict[str, Any]:
        s = scope(ctx)
        try:
            return workspace.set_agent_title(s.workspace_id, s.node_id, title)
        except Exception as error:
            return refuse(error)
