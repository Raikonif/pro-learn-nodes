## Why

A fresh install cannot start a conversation. `POST /workspace/nodes` exists, but nothing in the window calls it: the only creation controls make a child of an existing node or branch from a selected passage, and a new account's graph is empty — so the first session can never exist, and the chat `acp-agent-backend` made live has nowhere to be written. The left rail compounds it: it claims recency order, but `last_opened_at` is never updated after creation, so "recent" is creation order, and a session can be found only by its title.

A second problem sits underneath. The local session should be the identity and an agent only its executor, but a thread records a single `(agent_id, agent_session_id)`. Switching Codex → Claude → Codex discards Codex's session and replays the whole transcript, though Codex's own session still exists and has missed only what was said to Claude.

## What Changes

- **Create sessions from the window**, two ways: a **quick** start that opens an empty session on the default agent, ready to write, and a **detailed** start that asks for a topic and a learning mode first. A new account's empty workspace offers both.
- **Automatic titles**: a quick session is titled from its first message; the learner can rename it.
- **Session history** in the left rail: ordered by real last activity, grouped *Today / Yesterday / Previous 7 days / Older*, each entry showing the last message and the agent it ran on. Opening a session and writing in it both count as activity.
- **Search message content**, not only titles, through a local full-text index; a result opens the session at the matching message.
- **Archive, never delete, from the history**: an archived session leaves the history and the canvas, stays findable by explicit search, and can be restored. This uses the node archive state `node-projects-and-archive` designs (`archived_at`, one repository filter), pulled forward at node level only.
- **Agents are interchangeable executors of a local session.** A thread keeps one agent session **per agent**, each with a sync watermark. Returning to an agent resumes its own session and sends only what it missed; replay of the whole transcript remains only for an agent with no session yet or one that cannot be resumed.
- **BREAKING** (internal): `chat_threads.agent_id` / `agent_session_id` move into a new `agent_sessions` table; the migration carries existing values over.

## Capabilities

### New Capabilities

- `session-creation`: starting a root session — quick and detailed — and titling it.
- `session-history`: the left rail's listing of sessions by activity, its grouping and previews, content search, and archiving from it.

### Modified Capabilities

- `node-workspace-layout`: the left rail may present sessions grouped by date with previews, as long as it still lists sessions rather than threads and does not replace the graph.
- `node-agent-sessions` (introduced by `acp-agent-backend`): a session keeps one agent session per agent, and returning to an agent continues its own session with only what it missed.

## Impact

- **Backend**: `service/workspace.py` gains activity tracking, rename, archive/restore, and a session listing; `service/agent/sessions.py` moves from one session per thread to one per (thread, agent) with catch-up; a new `repository/session_repo.py`; an FTS5 table over message content kept in step by the service; routes for listing, searching, renaming, and archiving. One Alembic migration.
- **Frontend**: `features/study-launcher/` — so far an empty export — becomes the quick and detailed creation surface; `features/graph-navigation/`'s `RecentsRail` becomes the session history; the empty workspace gets an entry state.
- **Depends on** `acp-agent-backend`. **Coordinates with** `node-projects-and-archive`: node-level archive lands here with that change's column and filter, so its node-archive tasks become verifications and it adds projects and the project cascade.
- **Not in scope**: practice, and the local MCP server that exposes sessions, practice, and memory to agents — the next change.
