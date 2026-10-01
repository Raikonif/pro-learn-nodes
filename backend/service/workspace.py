"""Domain operations and bootstrap serialization for local workspaces."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session, select

from core.database import session_scope
from repository import session_repo
from core.exceptions import NotFoundError, ValidationError
from models.workspace import (
    ChatMessageRecord,
    ChatThreadRecord,
    NodeLinkRecord,
    SelectionAnchorRecord,
    WorkspaceContextRecord,
    WorkspaceNodeRecord,
    WorkspaceRecord,
    now,
)

BOOTSTRAP_SCHEMA_VERSION = 1


def _timestamp(value: object) -> str:
    timestamp = value  # SQLite returns a datetime without retaining the UTC offset.
    if timestamp.tzinfo is None:  # type: ignore[union-attr]
        timestamp = timestamp.replace(tzinfo=UTC)  # type: ignore[union-attr]
    return timestamp.astimezone(UTC).isoformat().replace("+00:00", "Z")  # type: ignore[union-attr]


def _workspace(session: Session, workspace_id: str) -> WorkspaceRecord:
    workspace = session.get(WorkspaceRecord, workspace_id)
    if workspace is None:
        raise NotFoundError(f"Unknown workspace: {workspace_id}")
    return workspace


def _node(session: Session, workspace_id: str, node_id: str) -> WorkspaceNodeRecord:
    node = session.get(WorkspaceNodeRecord, node_id)
    if node is None or node.workspace_id != workspace_id:
        raise NotFoundError(f"Unknown node: {node_id}")
    return node


PROVISIONAL_TITLE = "New session"
_TITLE_LIMIT = 60


def derive_title(text: str) -> str:
    """A title from a learner's first message: one line, at most 60 characters.

    Cut at a word boundary with an ellipsis, unless the only boundary is so
    early that the title would say nothing — then the word itself is cut.
    """

    collapsed = " ".join(text.split())
    if len(collapsed) <= _TITLE_LIMIT:
        return collapsed
    cut = collapsed[: _TITLE_LIMIT - 1]
    space = cut.rfind(" ")
    if space >= _TITLE_LIMIT // 3:
        cut = cut[:space]
    return cut.rstrip() + "…"


def note_message(session: Session, thread: ChatThreadRecord, role: str, content: str) -> None:
    """What recording a message does to its session, wherever it is recorded.

    Moves the session's last activity, and titles a provisional session from
    its first learner message. Every writer of a message calls this — the
    workspace route here and the turn service — so the history cannot drift
    from what was said.
    """

    node = session.get(WorkspaceNodeRecord, thread.node_id)
    node.last_activity_at = now()
    if role == "learner" and node.title_source == "provisional" and content.strip():
        node.title = derive_title(content)
        node.title_source = "auto"


def _thread(session: Session, workspace_id: str, thread_id: str) -> ChatThreadRecord:
    thread = session.get(ChatThreadRecord, thread_id)
    if thread is None or thread.workspace_id != workspace_id:
        raise NotFoundError(f"Unknown thread: {thread_id}")
    return thread


def _anchor(session: Session, workspace_id: str, payload: dict[str, Any]) -> SelectionAnchorRecord:
    source_message_id = payload["messageId"]
    message = session.get(ChatMessageRecord, source_message_id)
    if message is None or message.workspace_id != workspace_id:
        raise ValidationError("Selection anchor source message is not in this workspace")
    start_offset = payload["start"]
    end_offset = payload["end"]
    excerpt = payload["excerpt"]
    if start_offset < 0 or end_offset <= start_offset or not excerpt:
        raise ValidationError("Selection anchor offsets and excerpt are invalid")
    anchor = SelectionAnchorRecord(
        workspace_id=workspace_id,
        source_message_id=source_message_id,
        start_offset=start_offset,
        end_offset=end_offset,
        excerpt=excerpt,
    )
    session.add(anchor)
    session.flush()
    return anchor


def _bump_revision(workspace: WorkspaceRecord) -> None:
    workspace.revision += 1


def ensure_default_workspace(profile_id: str) -> WorkspaceRecord:
    """Return the workspace an account owns, provisioning it on first activation.

    The owner is required, not optional. Naming a profile narrows both halves
    of this: the search sees only that account's workspaces, and a workspace
    created here is stamped with the owner. Without the filter, the second
    account to activate would find the first account's workspace already
    present and adopt it — the exact crossing `account-profiles` forbids.

    An unowned workspace is no longer representable: `workspaces.profile_id`
    is not nullable, so a `None` default could only ever raise at the insert.
    """

    with session_scope() as session:
        statement = (
            select(WorkspaceRecord)
            .where(WorkspaceRecord.profile_id == profile_id)
            .order_by(WorkspaceRecord.created_at)
        )
        workspace = session.exec(statement).first()
        if workspace is not None:
            return workspace
        workspace = WorkspaceRecord(profile_id=profile_id)
        session.add(workspace)
        session.flush()
        session.add(WorkspaceContextRecord(workspace_id=workspace.id))
        return workspace


def validate_workspace_data() -> None:
    """Reject persisted state that cannot satisfy the workspace contracts."""

    with session_scope() as session:
        workspaces = session.exec(select(WorkspaceRecord)).all()
        for workspace in workspaces:
            context = session.exec(
                select(WorkspaceContextRecord).where(WorkspaceContextRecord.workspace_id == workspace.id)
            ).one_or_none()
            if context is None:
                raise ValidationError(f"Workspace {workspace.id} has no context")
            nodes = session.exec(
                select(WorkspaceNodeRecord).where(WorkspaceNodeRecord.workspace_id == workspace.id)
            ).all()
            for node in nodes:
                mains = session.exec(
                    select(ChatThreadRecord).where(
                        ChatThreadRecord.node_id == node.id,
                        ChatThreadRecord.anchor_id.is_(None),
                    )
                ).all()
                if len(mains) != 1:
                    raise ValidationError(f"Node {node.id} must have exactly one main thread")
            links = session.exec(
                select(NodeLinkRecord).where(NodeLinkRecord.workspace_id == workspace.id)
            ).all()
            for link in links:
                if _node(session, workspace.id, link.parent_id).workspace_id != workspace.id:
                    raise ValidationError(f"Link {link.id} has an invalid parent")
                if _node(session, workspace.id, link.child_id).workspace_id != workspace.id:
                    raise ValidationError(f"Link {link.id} has an invalid child")


def bootstrap(workspace_id: str | None = None) -> dict[str, Any]:
    with session_scope() as session:
        workspace = (
            _workspace(session, workspace_id)
            if workspace_id
            else session.exec(select(WorkspaceRecord).order_by(WorkspaceRecord.created_at)).first()
        )
        if workspace is None:
            raise NotFoundError("No local workspace exists")
        context = session.exec(
            select(WorkspaceContextRecord).where(WorkspaceContextRecord.workspace_id == workspace.id)
        ).one()
        # The one place archived sessions are filtered out of the graph. Links,
        # threads, and messages follow the nodes that remain, so nothing in
        # the snapshot refers to a node it does not contain.
        nodes = session.exec(
            select(WorkspaceNodeRecord)
            .where(
                WorkspaceNodeRecord.workspace_id == workspace.id,
                WorkspaceNodeRecord.archived_at.is_(None),
            )
            .order_by(WorkspaceNodeRecord.created_at)
        ).all()
        visible = {node.id for node in nodes}
        links = session.exec(
            select(NodeLinkRecord)
            .where(NodeLinkRecord.workspace_id == workspace.id)
            .order_by(NodeLinkRecord.id)
        ).all()
        links = [l for l in links if l.parent_id in visible and l.child_id in visible]
        threads = session.exec(
            select(ChatThreadRecord)
            .where(ChatThreadRecord.workspace_id == workspace.id)
            .order_by(ChatThreadRecord.id)
        ).all()
        threads = [t for t in threads if t.node_id in visible]
        visible_threads = {t.id for t in threads}
        messages = session.exec(
            select(ChatMessageRecord)
            .where(ChatMessageRecord.workspace_id == workspace.id)
            .order_by(ChatMessageRecord.created_at)
        ).all()
        messages = [m for m in messages if m.thread_id in visible_threads]
        anchors = {
            anchor.id: anchor
            for anchor in session.exec(
                select(SelectionAnchorRecord).where(SelectionAnchorRecord.workspace_id == workspace.id)
            ).all()
        }

        def anchor_value(anchor_id: str | None) -> dict[str, Any] | None:
            if anchor_id is None:
                return None
            anchor = anchors[anchor_id]
            return {
                "messageId": anchor.source_message_id,
                "start": anchor.start_offset,
                "end": anchor.end_offset,
                "excerpt": anchor.excerpt,
            }

        return {
            "schemaVersion": BOOTSTRAP_SCHEMA_VERSION,
            "workspaceId": workspace.id,
            "revision": workspace.revision,
            "graph": {
                "nodes": [
                    {
                        "id": node.id,
                        "title": node.title,
                        "mode": node.mode,
                        "body": node.body,
                        "activeSkills": node.active_skills,
                        "mcpServers": node.mcp_servers,
                        "backendAgentId": node.backend_agent_id,
                        "createdAt": _timestamp(node.created_at),
                        "lastOpenedAt": _timestamp(node.last_opened_at),
                        "lastActivityAt": _timestamp(node.last_activity_at),
                        "titleSource": node.title_source,
                    }
                    for node in nodes
                ],
                "links": [
                    {
                        "id": link.id,
                        "parentId": link.parent_id,
                        "childId": link.child_id,
                        "anchor": anchor_value(link.anchor_id),
                    }
                    for link in links
                ],
                "threads": [
                    {
                        "id": thread.id,
                        "nodeId": thread.node_id,
                        "name": thread.name,
                        "anchor": anchor_value(thread.anchor_id),
                    }
                    for thread in threads
                ],
                "messages": [
                    {
                        "id": message.id,
                        "threadId": message.thread_id,
                        "role": message.role,
                        "content": message.content,
                        "kind": message.kind,
                        "outcome": message.outcome,
                        "data": message.data,
                        "createdAt": _timestamp(message.created_at),
                    }
                    for message in messages
                ],
            },
            "context": {
                "lastOpenNodeId": (
                    context.last_open_node_id if context.last_open_node_id in visible else None
                ),
                "viewport": context.viewport,
            },
        }


def create_branch_node(
    workspace_id: str,
    source_node_id: str,
    anchor_payload: dict[str, Any],
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    overrides = overrides or {}
    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        source = _node(session, workspace_id, source_node_id)
        anchor = _anchor(session, workspace_id, anchor_payload)
        node = WorkspaceNodeRecord(
            workspace_id=workspace_id,
            title=overrides.get("title") or anchor.excerpt.strip()[:40] or "New node",
            mode=overrides.get("mode") or source.mode,
            active_skills=overrides.get("activeSkills") or list(source.active_skills),
            mcp_servers=overrides.get("mcpServers") or list(source.mcp_servers),
            backend_agent_id=source.backend_agent_id,
        )
        session.add(node)
        session.flush()
        session.add(ChatThreadRecord(workspace_id=workspace_id, node_id=node.id, name="main"))
        session.add(
            NodeLinkRecord(
                workspace_id=workspace_id,
                parent_id=source.id,
                child_id=node.id,
                anchor_id=anchor.id,
            )
        )
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def create_root_node(
    workspace_id: str,
    title: str | None,
    mode: str = "Explore",
    body: str = "",
    active_skills: list[str] | None = None,
    mcp_servers: list[str] | None = None,
) -> dict[str, Any]:
    """Create an unlinked session with its required main thread."""

    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        topic = " ".join((title or "").split())
        node = WorkspaceNodeRecord(
            workspace_id=workspace_id,
            # No topic: a quick start, titled from its first message.
            title=topic or PROVISIONAL_TITLE,
            title_source="topic" if topic else "provisional",
            mode=mode,
            body=body,
            active_skills=active_skills or [],
            mcp_servers=mcp_servers or [],
        )
        session.add(node)
        session.flush()
        session.add(ChatThreadRecord(workspace_id=workspace_id, node_id=node.id, name="main"))
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def create_child_node(workspace_id: str, parent_node_id: str) -> dict[str, Any]:
    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        parent = _node(session, workspace_id, parent_node_id)
        node = WorkspaceNodeRecord(
            workspace_id=workspace_id,
            title=f"New child of {parent.title}",
            mode=parent.mode,
            active_skills=list(parent.active_skills),
            mcp_servers=list(parent.mcp_servers),
            # Inherited even when the parent's agent is not installed or not
            # authenticated here: the child reports that on its first turn
            # rather than quietly running somewhere else.
            backend_agent_id=parent.backend_agent_id,
        )
        session.add(node)
        session.flush()
        main = ChatThreadRecord(workspace_id=workspace_id, node_id=node.id, name="main")
        session.add(main)
        session.add(
            NodeLinkRecord(workspace_id=workspace_id, parent_id=parent.id, child_id=node.id)
        )
        context = session.exec(
            select(WorkspaceContextRecord).where(WorkspaceContextRecord.workspace_id == workspace_id)
        ).one()
        context.last_open_node_id = node.id
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def create_thread(
    workspace_id: str, node_id: str, anchor_payload: dict[str, Any], name: str | None,
) -> dict[str, Any]:
    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        _node(session, workspace_id, node_id)
        anchor = _anchor(session, workspace_id, anchor_payload)
        thread = ChatThreadRecord(
            workspace_id=workspace_id,
            node_id=node_id,
            name=name or anchor.excerpt.strip()[:40] or "New chat",
            anchor_id=anchor.id,
        )
        session.add(thread)
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def append_message(workspace_id: str, thread_id: str, role: str, content: str) -> dict[str, Any]:
    if role not in {"learner", "agent"} or not content.strip():
        raise ValidationError("Message role or content is invalid")
    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        thread = _thread(session, workspace_id, thread_id)
        session.add(
            ChatMessageRecord(
                workspace_id=workspace_id,
                thread_id=thread_id,
                role=role,
                content=content,
            )
        )
        note_message(session, thread, role, content)
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def set_node_backend(workspace_id: str, node_id: str, agent_id: str) -> dict[str, Any]:
    """Move a node — and so every thread on it — to another registered agent.

    `agent_id` must already have been checked against the account by the
    caller. Threads keep the session they had; on their next turn the session
    is found to belong to a different agent and is replaced by replay, with
    the seam shown (`service/agent/sessions.py`).
    """

    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        node = _node(session, workspace_id, node_id)
        node.backend_agent_id = agent_id
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def _current_open(session: Session, workspace_id: str) -> str | None:
    return session.exec(
        select(WorkspaceContextRecord.last_open_node_id).where(
            WorkspaceContextRecord.workspace_id == workspace_id
        )
    ).one()


def rename_node(workspace_id: str, node_id: str, title: str) -> dict[str, Any]:
    if not title.strip():
        raise ValidationError("A session title cannot be empty")
    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        node = _node(session, workspace_id, node_id)
        node.title = " ".join(title.split())
        node.title_source = "learner"
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def archive_node(workspace_id: str, node_id: str) -> dict[str, Any]:
    """Retire a session: out of the history and the graph, nothing destroyed."""

    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        node = _node(session, workspace_id, node_id)
        if node.archived_at is None:
            node.archived_at = now()
        context = session.exec(
            select(WorkspaceContextRecord).where(WorkspaceContextRecord.workspace_id == workspace_id)
        ).one()
        if context.last_open_node_id == node.id:
            context.last_open_node_id = None
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def restore_node(workspace_id: str, node_id: str) -> dict[str, Any]:
    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        node = _node(session, workspace_id, node_id)
        node.archived_at = None
        _bump_revision(workspace)
    return bootstrap(workspace_id)


def search_sessions(workspace_id: str, query: str, include_archived: bool = False) -> dict[str, Any]:
    with session_scope() as session:
        _workspace(session, workspace_id)
        results = session_repo.search(
            session, workspace_id, query, include_archived=include_archived
        )
    for result in results:
        stored = result["lastActivityAt"]
        result["lastActivityAt"] = _timestamp(
            stored if isinstance(stored, datetime) else datetime.fromisoformat(str(stored))
        )
    return {"results": results}


# --- Reading for agents (the context server's read tools) -----------------------
#
# Bounded and progressive: an outline first, full text only by id. Every read
# is confined to the workspace and to unarchived sessions.

_OUTLINE_CHARS = 200
OUTLINE_PAGE = 50
MAX_FULL_MESSAGES = 10


def _visible_node(session: Session, workspace_id: str, node_id: str) -> WorkspaceNodeRecord:
    node = _node(session, workspace_id, node_id)
    if node.archived_at is not None:
        raise NotFoundError(f"Unknown node: {node_id}")
    return node


def session_summaries(workspace_id: str, limit: int = 20) -> dict[str, Any]:
    limit = min(max(limit, 1), 50)
    with session_scope() as session:
        nodes = session.exec(
            select(WorkspaceNodeRecord)
            .where(WorkspaceNodeRecord.workspace_id == workspace_id, WorkspaceNodeRecord.archived_at.is_(None))
            .order_by(WorkspaceNodeRecord.last_activity_at.desc())
            .limit(limit + 1)
        ).all()
        return {
            "sessions": [
                {"id": n.id, "title": n.title, "mode": n.mode, "lastActivityAt": _timestamp(n.last_activity_at)}
                for n in nodes[:limit]
            ],
            "truncated": len(nodes) > limit,
        }


def session_outline(workspace_id: str, node_id: str, offset: int = 0) -> dict[str, Any]:
    """A session's conversation, newest first, each message shortened, one page."""

    offset = max(offset, 0)
    with session_scope() as session:
        node = _visible_node(session, workspace_id, node_id)
        rows = session.exec(
            select(ChatMessageRecord)
            .join(ChatThreadRecord, ChatThreadRecord.id == ChatMessageRecord.thread_id)
            .where(ChatThreadRecord.node_id == node.id, ChatMessageRecord.kind == "message",
                   ChatMessageRecord.content != "")
            .order_by(ChatMessageRecord.created_at.desc())
            .offset(offset)
            .limit(OUTLINE_PAGE + 1)
        ).all()
        page = rows[:OUTLINE_PAGE]
        return {
            "session": {"id": node.id, "title": node.title, "mode": node.mode},
            "messages": [
                {
                    "id": m.id,
                    "role": m.role,
                    "preview": m.content if len(m.content) <= _OUTLINE_CHARS else m.content[: _OUTLINE_CHARS - 1] + "…",
                    "shortened": len(m.content) > _OUTLINE_CHARS,
                    "createdAt": _timestamp(m.created_at),
                }
                for m in page
            ],
            "partial": len(rows) > OUTLINE_PAGE,
            "next": str(offset + OUTLINE_PAGE) if len(rows) > OUTLINE_PAGE else None,
        }


def messages_by_ids(workspace_id: str, message_ids: list[str]) -> dict[str, Any]:
    """Full text of named messages — at most ten, only from this workspace's open sessions."""

    wanted = list(dict.fromkeys(message_ids))[:MAX_FULL_MESSAGES]
    with session_scope() as session:
        rows = session.exec(
            select(ChatMessageRecord, WorkspaceNodeRecord)
            .join(ChatThreadRecord, ChatThreadRecord.id == ChatMessageRecord.thread_id)
            .join(WorkspaceNodeRecord, WorkspaceNodeRecord.id == ChatThreadRecord.node_id)
            .where(ChatMessageRecord.id.in_(wanted), ChatMessageRecord.workspace_id == workspace_id,
                   WorkspaceNodeRecord.archived_at.is_(None))
        ).all()
        found = {m.id: {"id": m.id, "sessionId": n.id, "role": m.role, "content": m.content,
                        "createdAt": _timestamp(m.created_at)} for m, n in rows}
    return {
        "messages": [found[i] for i in wanted if i in found],
        "notFound": [i for i in wanted if i not in found],
        "truncated": len(message_ids) > MAX_FULL_MESSAGES,
    }


def set_agent_title(workspace_id: str, node_id: str, title: str) -> dict[str, Any]:
    """An agent titles a session — only while no one chose its title."""

    title = " ".join(title.split())
    if not title:
        raise ValidationError("A session title cannot be empty")
    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        node = _visible_node(session, workspace_id, node_id)
        if node.title_source not in ("provisional", "auto"):
            raise ValidationError("This session's title was chosen by the learner and is kept.")
        node.title = title[:120]
        node.title_source = "auto"
        _bump_revision(workspace)
        return {"id": node.id, "title": node.title}


def update_context(
    workspace_id: str, last_open_node_id: str | None, viewport: dict[str, Any],
) -> dict[str, Any]:
    with session_scope() as session:
        workspace = _workspace(session, workspace_id)
        if last_open_node_id is not None:
            opened = _node(session, workspace_id, last_open_node_id)
            if opened.archived_at is not None:
                raise ValidationError("An archived session must be restored before it is opened")
            if opened.id != _current_open(session, workspace_id):
                # Opening counts as activity; re-saving the viewport of the
                # session already open does not.
                opened.last_opened_at = opened.last_activity_at = now()
        context = session.exec(
            select(WorkspaceContextRecord).where(WorkspaceContextRecord.workspace_id == workspace_id)
        ).one()
        context.last_open_node_id = last_open_node_id
        context.viewport = viewport
        _bump_revision(workspace)
    return bootstrap(workspace_id)
