## Context

`acp-agent-backend` made a node's conversation live, but a learner cannot reach one: nothing in the window creates a root node, and a new account's graph is empty. The left rail (`RecentsRail`) sorts by `lastOpenedAt`, which the backend never updates after creation, and it matches titles only.

Underneath, `acp-agent-backend` already made the application's transcript authoritative and the agent's session a cache. What it did not do is keep more than one cache per thread: `chat_threads` holds a single `(agent_id, agent_session_id)`, so a switch between agents always costs a full replay, even back to an agent whose own session is intact.

A "session" in the learner's vocabulary is a **node**: a root node with its main thread and any side threads. This change uses the word in the UI and keeps `node` in code.

## Goals / Non-Goals

**Goals**

- A fresh install reaches a conversation in one action.
- The history is ordered by what the learner actually did, findable by what was said, and never loses anything.
- The local session is the identity; agents are interchangeable executors that each keep their own session and are told only what they missed.

**Non-Goals**

- Hard deletion. Archive only; the confirmed destructive delete stays in `node-projects-and-archive`.
- Projects and the project archive cascade — `node-projects-and-archive`.
- Titles written by an agent. See Decisions.
- Exposing sessions, practice, or memory to agents — the next change, over a local MCP server.

## Decisions

### Activity is one column, bumped where activity happens

`workspace_nodes` gains `last_activity_at`, set on creation, when the node is opened (`PUT /workspace/context` naming it), and whenever a message is recorded in any of its threads. The migration backfills it with the later of `last_opened_at` and the node's newest message.

One column rather than deriving "last activity" from `max(messages.created_at)` at read time: the history is read on every bootstrap and the derived form is a grouped join over every message the learner ever wrote. The column is written on paths that already write.

Grouping into Today / Yesterday / Previous 7 days / Older happens in the frontend, against the learner's local calendar. The backend stores UTC and cannot know what "yesterday" means to the person looking.

### Titles: provisional, then derived locally from the first message

`workspace_nodes` gains `title_source`: `provisional`, `auto`, `topic`, or `learner`. A quick session starts `provisional` ("New session"). When its first learner message is recorded, the title is derived from it — whitespace collapsed, cut at a word boundary to 60 characters — and `title_source` becomes `auto`. A `topic` or `learner` title is never overwritten.

*Alternative considered — ask the agent for a title.* It is what ChatGPT does, and it reads better. Rejected for now: an agent here is session-stateful, so a titling request is a turn in the learner's own conversation, visible in its history and billed to their subscription, and it cannot run before the agent's first answer. The local derivation is instant and free. The next change's MCP server can offer agents a `set_title` tool, which lets an agent title a session without a turn spent on it.

### Content search is FTS5 kept in step by triggers

A `message_fts` FTS5 table indexes `chat_messages.content` for `kind = 'message'`, with `message_id`, `thread_id`, and `workspace_id` UNINDEXED — the shape `source_chunk_fts` already uses. Queries follow `service/retrieval.py`: terms quoted and ANDed, filtered by `workspace_id`, ordered by `bm25`, and the matching passage returned with `snippet()`.

It is maintained by SQLite triggers on insert, update, and delete of `chat_messages`, created in the migration — unlike `source_chunk_fts`, which the service maintains. Messages are written from five places (`append_message`, and the turn service's start, stream, record, and finish paths), and the stream path rewrites a message's content every quarter second. A trigger cannot be forgotten by a sixth writer; a service convention can. The update trigger is a delete and an insert of one row — cheap at the rates a local conversation produces.

Archived sessions are excluded unless the request says otherwise, by joining through the node.

### Archive is node-level `archived_at`, as `node-projects-and-archive` designed it

`workspace_nodes.archived_at` (nullable) — the same column, with the same meaning, that `node-projects-and-archive` specifies. This change adds only the node-level part: archive and restore one node. The project cascade (`archived_with_project_id`) and projects remain that change's.

The filter lives in one place, the bootstrap query and the session listing, as that design requires. An archived node's links are omitted from the graph, so its children remain on the canvas as unlinked nodes rather than disappearing with it — archiving a parent never hides the branches that grew from it. Showing a dangling link *to* an archived node is `node-projects-and-archive`'s requirement, not this one's.

An archived session is opened by restoring it; there is no read-only view of an archived session in this change.

### One agent session per (thread, agent), with a watermark

A new `agent_sessions` table replaces `chat_threads.agent_id` and `agent_session_id`:

| column | meaning |
|---|---|
| `thread_id`, `agent_id` | unique together |
| `session_id` | the agent's own session id |
| `synced_through` | `created_at` of the last recorded message this agent has been given |

A turn on agent A for thread T:

1. **A has a session for T** → continue it (already open in this process, else `session/load`). Prompt with the messages recorded after `synced_through`, excluding the new learner message, rendered as *"While you were away, the conversation continued:"*, followed by the new message. If there are none, the prompt is the learner's message alone — the common case.
2. **A has no session for T, or loading fails** → `session/new` and replay the full transcript, recording a continuity seam, exactly as `acp-agent-backend` does.
3. When the turn ends, in any outcome, set `synced_through` to the agent reply's `created_at`: the agent has now seen everything up to and including its own answer.

This is what makes a local session the identity. Codex and Claude each hold a cache of the same conversation; the application's record is the only complete copy, and each cache is topped up from it on demand. The replay primitive stays — branching in `acp-agent-permissions-and-branching` still needs it — and becomes the exception rather than the switch path.

*Catch-up is text, not tool calls.* What another agent did with tools is recorded as `tool` messages; catch-up passes the conversation (`kind = 'message'`) only. An agent returning to a thread learns what was said, not every file another agent touched. The next change's MCP server is where an agent asks for more.

### Creation reuses the existing route

`POST /workspace/nodes` already creates a root node with its main thread. `title` becomes optional (absent → provisional), and `mode` is already accepted. The quick start sends nothing; the detailed start sends the topic and mode. No backend is chosen at creation: the first turn resolves the default and records it, as `acp-agent-backend` specifies.

### The history reads bootstrap; search is its own route

Bootstrap's node entries gain `lastActivityAt`, `titleSource`, and `archived: false` (archived nodes are not in bootstrap). Previews and agent names are computed in the frontend from data it already holds — bootstrap messages and `GET /agents` — so the history needs no route of its own.

Search needs one: `GET /workspace/sessions/search?q=&includeArchived=` → `{ results: [{ nodeId, title, archived, threadId, messageId, snippet, lastActivityAt }] }`. Title matches return with `messageId: null`.

New mutations: `PUT /workspace/nodes/{id}/title` `{ title }`, `POST /workspace/nodes/{id}/archive`, `POST /workspace/nodes/{id}/restore` — each returning bootstrap, like the existing node routes, and each scoped by the account dependency.

### The left-rail requirement is amended, not bypassed

`node-workspace-layout` forbids presenting nodes "as a flat chat history in place of the graph". The intent is that the graph stays the product's navigation. A date-grouped history beside a graph that remains fully present does not replace it, so the requirement is modified to say what is allowed — grouping and previews — and what still is not: threads as entries, and losing the graph.

## Risks / Trade-offs

- **FTS on streaming writes.** The update trigger fires on every persisted chunk batch. Measured 2026-10-01: 2,000 successive rewrites of a growing message cost 0.18s without the triggers and 0.56s with them — +0.19 ms per write. That is the worst case (a write per chunk); the turn service writes at most every 250 ms, where the trigger is 0.08% of a turn, far under the 10% that would have justified indexing agent messages only once their outcome is set. Kept as designed.
- **Catch-up grows with the gap.** An agent absent for a long exchange receives all of it. There is no cap in this change; compaction is declared unavailable on agent backends, and truncating silently would be worse. A long gap is visible in the prompt size reported by `usage`.
- **Two changes touching archive.** `node-projects-and-archive` must be updated to build on this change's node archive rather than re-add it. Recorded in its README when this change is applied.
- **Timezone.** Grouping by local date means the same data groups differently when the learner travels. That is the intended behavior.

## Migration Plan

One Alembic revision:

1. Add `workspace_nodes.last_activity_at` (backfilled as above), `title_source` (existing rows `topic` — they were all created with an explicit title), and `archived_at` (null).
2. Create `agent_sessions`; copy every thread's non-null `(agent_id, agent_session_id)` into it with `synced_through` set to the thread's newest message; then drop the two columns from `chat_threads` with SQLite's own `ALTER TABLE ... DROP COLUMN` (3.35+; the bundled library is 3.50). No rebuild: a batch rebuild would reconstruct the partial unique index `uq_main_thread_per_node` from reflection, which is where a `WHERE` clause goes missing. A test compares the table's foreign keys and that index before and after.
3. Create `message_fts`, populate it from existing messages, and create its triggers.

Downgrade reverses each step; `agent_sessions` rows collapse back into the thread, keeping the most recently synced one.

## Open Questions

- Should the quick-start control live in the left rail header, the center, or both? The spec requires it in the empty workspace; elsewhere is a layout call to make during implementation, following `node-workspace-layout`.
- Does a learner want to see *which* agents a session has run on, not just the last one? The table makes it cheap; the history shows only the last to stay compact.
