"""A node's conversation, run on an agent-owned session.

The application's transcript is authoritative and the agent's session is a
cache over it (design: "The application's transcript is authoritative"). So a
turn is recorded before it is sent, its content is written as it arrives, and
its outcome is written when it ends — and only then is the agent's session
worth anything, as a way to avoid re-sending what the transcript already says.

Continuity, in order of preference:

1. The session is already open in this agent process — prompt it directly.
2. The thread's session belongs to this agent and the agent reported
   `loadSession` — load it once, then prompt.
3. Otherwise open a fresh session and hand it the recorded transcript, and
   record a continuity seam so the conversation does not pretend the break
   did not happen. That same primitive is what branching reuses in
   `acp-agent-permissions-and-branching`.
"""

from __future__ import annotations

import asyncio
import logging
import time
import weakref
from datetime import datetime, timedelta
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlmodel import select

from core.database import session_scope
from core.exceptions import NotFoundError
from models.agent import AgentRegistrationRecord
from models.workspace import (
    AgentSessionRecord,
    ChatMessageRecord,
    ChatThreadRecord,
    WorkspaceNodeRecord,
    WorkspaceRecord,
)
from repository import agent_repo
from service.workspace import note_message
from service.context_server.credentials import Scope
from service.context_server.orientation import ORIENTATION_NOTE
from service.agent.contract import (
    McpServer,
    Agent,
    AgentError,
    AgentNotAuthenticated,
    PermissionRefused,
    PlanUpdate,
    SessionLoadFailed,
    TextChunk,
    ThoughtChunk,
    ToolActivity,
    TurnEnded,
    Usage,
)

__all__ = ["AgentProvider", "TurnService", "node_directory", "render_transcript"]

logger = logging.getLogger(__name__)

# Given the account and a registration, return its connected agent.
AgentProvider = Callable[[str, AgentRegistrationRecord], Awaitable[Agent]]

TurnEvent = tuple[str, dict[str, Any]]

# How often accumulating text is written while a turn streams. Frequent
# enough that a dropped connection loses under a second of it; infrequent
# enough that a fast agent does not turn into a write per token.
_PERSIST_INTERVAL = 0.25

_NO_AGENT = "No agent is registered. Register one in Settings → Agents to start a conversation."


def node_directory(data_dir: Path, node_id: str) -> Path:
    """The agent's working directory for one node — empty, and only this node's.

    Beside the data store, never inside it, and never a parent of another
    node's: `agent-workspaces/<node_id>` under the local data dir.
    """

    return data_dir / "agent-workspaces" / node_id


def render_transcript(messages: list[ChatMessageRecord], agent_label: str = "You") -> str:
    lines = []
    for message in messages:
        speaker = "Learner" if message.role == "learner" else agent_label
        lines.append(f"{speaker}: {message.content}")
    return "\n\n".join(lines)


def _replay_prompt(transcript: str, text: str) -> str:
    return (
        "This conversation began in an earlier session that could not be resumed. "
        "Here is the conversation so far, recorded by the learning application; "
        "continue it as if it had never been interrupted.\n\n"
        f"<conversation>\n{transcript}\n</conversation>\n\n"
        f"The learner's new message:\n\n{text}"
    )


def _catch_up_prompt(missed: str, text: str) -> str:
    return (
        "While you were away, the conversation continued with another assistant. "
        "Here is what was said since your last reply, recorded by the learning "
        "application; take it into account and continue.\n\n"
        f"<conversation>\n{missed}\n</conversation>\n\n"
        f"The learner's new message:\n\n{text}"
    )


# Commands ask for practice delivered to a rail tool rather than an answer in
# the conversation. The instruction is the application's; what the learner
# typed is recorded unchanged.
COMMAND_TOOL = {"code": "code", "qa": "qa", "quiz": "quiz"}
_COMMAND_INSTRUCTION = {
    "quiz": "Create these as multiple-choice questions with the learn-nodes `add_question` tool "
    "(kind `multiple_choice`), one call per question. Do not write the questions in this "
    "conversation; reply only with a short note that they are in the Quiz panel.",
    "qa": "Create these as free-response questions with the learn-nodes `add_question` tool "
    "(kind `free_response`), one call per question. Do not write the questions in this "
    "conversation; reply only with a short note that they are in the Q&A panel.",
    "code": "Create this as a code exercise with the learn-nodes `add_code_exercise` tool: a clear "
    "statement, starter code, and the expected output if the result is deterministic. Do not "
    "write the exercise or its solution in this conversation; reply only with a short note "
    "that it is in the Code panel.",
}
_TOOL_LABEL = {"qa": "Q&A", "quiz": "Quiz", "code": "Code"}


def _delivery_line(agent_name: str, tool: str, count: int) -> str:
    noun = "exercise" if tool == "code" else "question"
    amount = f"{'an' if noun == 'exercise' else 'a'} {noun}" if count == 1 else f"{count} {noun}s"
    return f"{agent_name} sent {amount} to {_TOOL_LABEL[tool]}"


@dataclass
class _Continuation:
    """How this turn reaches the agent: which session, and what else to send.

    `seam` is `(seam message id, transcript)` when the conversation had to be
    handed over whole; `missed` is the rendered exchange since this agent's
    watermark when its own session continues. At most one is set.
    """

    session_id: str
    row_id: str
    seam: tuple[str, str] | None = None
    missed: str | None = None
    # A session opened on this turn: its first prompt carries the orientation.
    fresh: bool = False


@dataclass
class _ActiveTurn:
    agent: Agent
    session_id: str


class TurnService:
    """Runs streaming turns and tracks which ones are in progress.

    One per application: the set of turns in progress and the sessions open
    in each agent process are shared by every request.
    """

    def __init__(
        self, data_dir: Path, agents: AgentProvider, context: Any = None, *, orientation: bool = True
    ) -> None:
        self._data_dir = data_dir
        self._agents = agents
        # Off only to measure what agents do without being told (task 7.1).
        self._orientation = orientation
        # The context server (`service/context_server/app.py:ContextServer`),
        # or None when it is not running — sessions then open without it.
        self._context = context
        self._active: dict[str, _ActiveTurn] = {}
        # Sessions open in each live agent object. Keyed weakly so a crashed
        # agent the supervisor dropped takes its sessions with it — its
        # replacement has none open, and loads them again.
        self._open: weakref.WeakKeyDictionary[Agent, set[str]] = weakref.WeakKeyDictionary()

    async def cancel(self, turn_id: str) -> bool:
        turn = self._active.get(turn_id)
        if turn is None:
            return False
        await turn.agent.cancel(turn.session_id)
        return True

    async def run_turn(
        self,
        profile_id: str,
        workspace_id: str,
        thread_id: str,
        text: str,
        command: str | None = None,
    ) -> AsyncIterator[TurnEvent]:
        turn_id = str(uuid4())
        learner_id, agent_message_id, node_id, registration = self._start(
            profile_id, workspace_id, thread_id, text
        )
        yield "turn.started", {
            "turnId": turn_id,
            "threadId": thread_id,
            "learnerMessageId": learner_id,
            "agentMessageId": agent_message_id,
        }

        if registration is None:
            self._finish(agent_message_id, "", "failed", _NO_AGENT)
            yield "turn.ended", {"outcome": "failed", "reason": "no_agent", "detail": _NO_AGENT}
            return

        try:
            agent = await self._agents(profile_id, registration)
            continuation = await self._session(
                agent, registration, profile_id, workspace_id, node_id, thread_id
            )
        except AgentNotAuthenticated as error:
            detail = (
                f"{registration.name} is not signed in. Sign in through its own client, "
                f"then send the message again. ({error})"
            )
            self._finish(agent_message_id, "", "failed", detail)
            yield "turn.ended", {"outcome": "failed", "reason": "not_authenticated", "detail": detail}
            return
        except AgentError as error:
            detail = f"{registration.name} could not be reached: {error}"
            self._finish(agent_message_id, "", "failed", detail)
            yield "turn.ended", {"outcome": "failed", "reason": "unreachable", "detail": detail}
            return

        session_id = continuation.session_id
        prompt = text
        if continuation.seam is not None:
            seam_id, transcript = continuation.seam
            yield "continuity.seam", {"messageId": seam_id, "reason": "session_not_resumed"}
            prompt = _replay_prompt(transcript, text)
        elif continuation.missed:
            prompt = _catch_up_prompt(continuation.missed, text)
        if command in _COMMAND_INSTRUCTION:
            prompt = f"{_COMMAND_INSTRUCTION[command]}\n\nThe learner asked: {prompt}"
        if continuation.fresh and self._context is not None and self._orientation:
            prompt = f"{ORIENTATION_NOTE}\n\n{prompt}"

        bus = getattr(self._context, "deliveries", None)
        inbox = bus.subscribe(node_id, thread_id) if bus is not None else None
        delivered: dict[str, tuple[str, list[str]]] = {}

        def drain() -> list[TurnEvent]:
            """Turn this turn's deliveries into stream events and one record per tool."""

            out: list[TurnEvent] = []
            while inbox is not None and not inbox.empty():
                delivery = inbox.get_nowait()
                message_id, item_ids = delivered.get(delivery.tool, (None, []))
                item_ids = item_ids + [i for i in delivery.item_ids if i not in item_ids]
                line = _delivery_line(delivery.agent_name, delivery.tool, len(item_ids))
                data = {"tool": delivery.tool, "itemIds": item_ids}
                message_id = self._record_delivery(workspace_id, thread_id, message_id, line, data)
                delivered[delivery.tool] = (message_id, item_ids)
                out.append(("practice.delivered", {
                    "messageId": message_id, "tool": delivery.tool,
                    "itemIds": item_ids, "agentName": delivery.agent_name,
                }))
            return out

        self._active[turn_id] = _ActiveTurn(agent, session_id)
        content = ""
        written_at = time.monotonic()
        tool_messages: dict[str, str] = {}
        ended = False
        try:
            async for event in agent.prompt(session_id, prompt):
                for delivered_event in drain():
                    yield delivered_event
                if isinstance(event, TextChunk):
                    content += event.text
                    if time.monotonic() - written_at >= _PERSIST_INTERVAL:
                        self._write_content(agent_message_id, content)
                        written_at = time.monotonic()
                    yield "text", {"text": event.text}
                elif isinstance(event, ThoughtChunk):
                    yield "thought", {"text": event.text}
                elif isinstance(event, ToolActivity):
                    message_id = self._record_tool(workspace_id, thread_id, tool_messages, event)
                    yield "tool", {
                        "messageId": message_id,
                        "toolCallId": event.tool_call_id,
                        "title": event.title,
                        "kind": event.kind,
                        "status": event.status,
                    }
                elif isinstance(event, PermissionRefused):
                    message_id = self._record(
                        workspace_id, thread_id, "permission_refused", event.title, "refused"
                    )
                    yield "permission.refused", {"messageId": message_id, "title": event.title}
                elif isinstance(event, PlanUpdate):
                    yield "plan", {
                        "entries": [{"content": e.content, "status": e.status} for e in event.entries]
                    }
                elif isinstance(event, Usage):
                    yield "usage", {
                        "inputTokens": event.input_tokens,
                        "outputTokens": event.output_tokens,
                        "totalTokens": event.total_tokens,
                        "model": event.model,
                    }
                elif isinstance(event, TurnEnded):
                    ended = True
                    # Writes can land after the agent's last event; collect them
                    # before the turn is declared over.
                    await asyncio.sleep(0)
                    for delivered_event in drain():
                        yield delivered_event
                    tool = COMMAND_TOOL.get(command or "")
                    if tool is not None and tool not in delivered:
                        self._record_delivery(
                            workspace_id, thread_id, None,
                            f"Nothing was sent to {_TOOL_LABEL[tool]} — the agent answered in the conversation instead.",
                            {"tool": tool}, kind="practice_not_delivered",
                        )
                    self._finish(agent_message_id, content, event.outcome)
                    yield "turn.ended", {"outcome": event.outcome, "reason": event.reason}
                    return
        finally:
            if inbox is not None:
                bus.unsubscribe(node_id, thread_id, inbox)
            self._active.pop(turn_id, None)
            # The agent has now been given everything up to this turn, however
            # it ended: its next turn needs only what comes after the reply.
            self._mark_synced(continuation.row_id, agent_message_id)
            if not ended:
                # The stream was abandoned — the client disconnected or the
                # request was cancelled. Stop the agent rather than let it
                # finish an answer nobody will see arrive, and keep what came
                # in, still marked incomplete.
                self._write_content(agent_message_id, content)
                try:
                    await asyncio.shield(agent.cancel(session_id))
                except Exception:  # The agent may already be gone.
                    logger.debug("cancel after abandoned turn failed", exc_info=True)

    # --- Recording --------------------------------------------------------

    def _start(
        self, profile_id: str, workspace_id: str, thread_id: str, text: str
    ) -> tuple[str, str, str, AgentRegistrationRecord | None]:
        """Record the learner's message and an incomplete agent message.

        Also resolves the node's backend and, if it had none, records the
        account default on the node — so changing the default later never
        silently moves this conversation to another agent.
        """

        with session_scope() as session:
            thread = session.exec(
                select(ChatThreadRecord).where(
                    ChatThreadRecord.id == thread_id,
                    ChatThreadRecord.workspace_id == workspace_id,
                )
            ).first()
            if thread is None:
                raise NotFoundError("Thread not found")
            node = session.get(WorkspaceNodeRecord, thread.node_id)
            registration = None
            if node.backend_agent_id is not None:
                registration = agent_repo.get(session, profile_id, node.backend_agent_id)
            if registration is None:
                registration = agent_repo.default_for(session, profile_id)
                if registration is not None:
                    node.backend_agent_id = registration.id
            learner = ChatMessageRecord(
                workspace_id=workspace_id, thread_id=thread_id, role="learner", content=text
            )
            session.add(learner)
            note_message(session, thread, "learner", text)
            session.flush()
            reply = ChatMessageRecord(
                workspace_id=workspace_id,
                thread_id=thread_id,
                role="agent",
                content="",
                outcome="incomplete",
            )
            session.add(reply)
            session.get(WorkspaceRecord, workspace_id).revision += 1
            session.flush()
            if registration is not None:
                session.expunge(registration)
            return learner.id, reply.id, node.id, registration

    def _record(
        self, workspace_id: str, thread_id: str, kind: str, content: str, outcome: str | None
    ) -> str:
        with session_scope() as session:
            record = ChatMessageRecord(
                workspace_id=workspace_id,
                thread_id=thread_id,
                role="agent",
                kind=kind,
                content=content,
                outcome=outcome,
            )
            session.add(record)
            session.flush()
            return record.id

    def _record_delivery(
        self,
        workspace_id: str,
        thread_id: str,
        message_id: str | None,
        content: str,
        data: dict[str, Any],
        kind: str = "practice_delivered",
    ) -> str:
        with session_scope() as session:
            if message_id is not None:
                record = session.get(ChatMessageRecord, message_id)
                record.content, record.data = content, data
                return record.id
            record = ChatMessageRecord(
                workspace_id=workspace_id, thread_id=thread_id, role="agent",
                kind=kind, content=content, data=data,
            )
            session.add(record)
            session.flush()
            return record.id

    def _record_tool(
        self,
        workspace_id: str,
        thread_id: str,
        tool_messages: dict[str, str],
        event: ToolActivity,
    ) -> str:
        message_id = tool_messages.get(event.tool_call_id)
        if message_id is None:
            message_id = self._record(
                workspace_id, thread_id, "tool", event.title or event.tool_call_id, event.status
            )
            tool_messages[event.tool_call_id] = message_id
            return message_id
        with session_scope() as session:
            record = session.get(ChatMessageRecord, message_id)
            if event.title:
                record.content = event.title
            if event.status:
                record.outcome = event.status
        return message_id

    def _write_content(self, message_id: str, content: str) -> None:
        with session_scope() as session:
            session.get(ChatMessageRecord, message_id).content = content

    def _finish(
        self, message_id: str, content: str, outcome: str, detail: str | None = None
    ) -> None:
        with session_scope() as session:
            record = session.get(ChatMessageRecord, message_id)
            record.content = content or detail or ""
            record.outcome = outcome
            note_message(session, session.get(ChatThreadRecord, record.thread_id), "agent", record.content)
            workspace = session.get(WorkspaceRecord, record.workspace_id)
            workspace.revision += 1

    # --- Sessions ---------------------------------------------------------

    async def _session(
        self,
        agent: Agent,
        registration: AgentRegistrationRecord,
        profile_id: str,
        workspace_id: str,
        node_id: str,
        thread_id: str,
    ) -> _Continuation:
        """Continue this agent's own session for the thread, or hand it over.

        In order: the agent's session is already open in this process; it
        can be loaded; or a fresh session is opened and given the whole
        transcript, with a seam recorded. A continued session is given only
        the exchange since its watermark — nothing, when it missed nothing.
        """

        cwd = node_directory(self._data_dir, node_id)
        cwd.mkdir(parents=True, exist_ok=True)
        with session_scope() as session:
            row = session.exec(
                select(AgentSessionRecord).where(
                    AgentSessionRecord.thread_id == thread_id,
                    AgentSessionRecord.agent_id == registration.id,
                )
            ).first()
            recorded = (row.id, row.session_id, row.synced_through) if row else None
            earlier = session.exec(
                select(ChatMessageRecord)
                .where(
                    ChatMessageRecord.thread_id == thread_id,
                    ChatMessageRecord.kind == "message",
                    ChatMessageRecord.content != "",
                )
                .order_by(ChatMessageRecord.created_at)
            ).all()
            # The last is the learner message this turn just recorded; the
            # empty reply beside it is already excluded by content.
            *history, current = earlier
            current_at = current.created_at
        open_sessions = self._open.setdefault(agent, set())

        if recorded is not None:
            row_id, session_id, synced_through = recorded
            continued = session_id in open_sessions
            if not continued and agent.negotiation.load_session:
                try:
                    await agent.load_session(
                        session_id,
                        cwd,
                        self._servers(registration, profile_id, workspace_id, node_id, thread_id),
                    )
                except SessionLoadFailed:
                    logger.info("session %s could not be loaded; replaying", session_id)
                else:
                    open_sessions.add(session_id)
                    continued = True
            if continued:
                missed = [
                    m for m in history if synced_through is None or m.created_at > synced_through
                ]
                return _Continuation(
                    session_id,
                    row_id,
                    missed=render_transcript(missed, agent_label="Another assistant") or None,
                )

        session_id = await agent.new_session(
            cwd, self._servers(registration, profile_id, workspace_id, node_id, thread_id)
        )
        open_sessions.add(session_id)
        with session_scope() as session:
            row = session.exec(
                select(AgentSessionRecord).where(
                    AgentSessionRecord.thread_id == thread_id,
                    AgentSessionRecord.agent_id == registration.id,
                )
            ).first()
            if row is None:
                row = AgentSessionRecord(
                    thread_id=thread_id, agent_id=registration.id, session_id=session_id
                )
                session.add(row)
            else:
                row.session_id = session_id
            row.synced_through = None
            session.flush()
            row_id = row.id
        if not history:
            return _Continuation(session_id, row_id, fresh=True)
        reason = (
            f"{registration.name} could not continue an earlier session of this conversation, "
            "so it was handed the conversation from this record."
        )
        # The seam belongs before the message that found the break, not after
        # the reply to it, so it takes a timestamp just ahead of it.
        seam_at = current_at - timedelta(microseconds=1)
        with session_scope() as session:
            seam_id = self._record_in(session, thread_id, "continuity_seam", reason, seam_at)
        return _Continuation(
            session_id, row_id, seam=(seam_id, render_transcript(history)), fresh=True
        )

    def _servers(
        self,
        registration: AgentRegistrationRecord,
        profile_id: str,
        workspace_id: str,
        node_id: str,
        thread_id: str,
    ) -> list[McpServer]:
        """The context server, with a credential minted for this one session.

        Minting again for the same thread and agent revokes the previous
        credential, so a loaded session's old token stops working.
        """

        if self._context is None or self._context.port is None:
            return []
        token = self._context.credentials.mint(
            Scope(profile_id, workspace_id, node_id, thread_id, registration.id, registration.name)
        )
        return [McpServer("learn-nodes", self._context.url, (("Authorization", f"Bearer {token}"),))]

    def _mark_synced(self, row_id: str, reply_id: str) -> None:
        with session_scope() as session:
            reply = session.get(ChatMessageRecord, reply_id)
            session.get(AgentSessionRecord, row_id).synced_through = reply.created_at

    @staticmethod
    def _record_in(
        session: Any, thread_id: str, kind: str, content: str, created_at: datetime
    ) -> str:
        thread = session.get(ChatThreadRecord, thread_id)
        record = ChatMessageRecord(
            workspace_id=thread.workspace_id,
            thread_id=thread_id,
            role="agent",
            kind=kind,
            content=content,
            created_at=created_at,
        )
        session.add(record)
        session.flush()
        return record.id
