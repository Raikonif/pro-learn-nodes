## Context

`local-sessions-and-history` keeps one agent session per (thread, agent) and gives an agent what it missed; `acp-agent-backend` replays a thread's own transcript into a fresh session. Neither looks past the thread. A branched node's main thread, and a side thread spawned from a passage, therefore open their first agent session with nothing — the origin is recorded in the graph (`node_links.anchor_id`, `chat_threads.anchor_id`, `selection_anchors.source_message_id`) but never reaches an agent.

## Goals / Non-Goals

**Goals**: a branch's agent knows what it branched from, cut exactly at the passage; one mechanism for every agent; bounded cost.

**Non-Goals**: grandparent context; native `session/fork`; changing what the child records.

## Decisions

### The origin is resolved from what the graph already records

- **A node's origin** is the link that created it — the earliest `node_links` row with `child_id` = the node (a node may later gain more parents in the DAG; the first is the one it grew from). Its `anchor_id`, if set, names the passage; its source message is the cut point. With no anchor, the cut point is the child's `created_at`.
- **A side thread's origin** is its own `anchor_id`; the cut point is the anchor's source message, in whatever thread that message lives.
- The inherited conversation is the `kind = 'message'`, non-empty messages of the **thread the cut point lives in**, up to and including it (or, for a whole-node child, the parent's main thread up to the child's creation).

### Inheritance is part of opening a fresh session, not of the first turn

The preamble is added whenever `TurnService` opens a **new** agent session for the thread — its first turn, a switch to an agent that has no session for it, or a replay after a failed load. A continued or loaded session already holds it. This is what makes switching agents inside a branched child keep its origin: the new agent is handed the origin, then the child's own transcript, then the new message.

Order in the prompt: orientation note (if any) → origin preamble → replayed child transcript (if any) → the learner's message.

### Bounded by characters, newest first, the cut message always kept

A 24,000-character budget for the inherited transcript. Messages are taken from the cut point backwards until the budget is spent; the cut message is always included, truncated from its start if it alone exceeds the budget. When anything was left out, the preamble says so. Characters, not tokens: no tokenizer belongs in the backend, and the budget only has to be conservative.

### The UI derives the origin from bootstrap

Bootstrap already carries every link (with its anchor) and every thread's anchor. The origin line is derived in the frontend; returning to it reuses `openSessionAt(nodeId, threadId, messageId)` from the session history. No new route.

### Native fork stays unused

Both measured agents report `session/fork`, but a fork copies a session as it stands. A branch cuts at a passage partway through, and anything after it must be absent. A fork would also only exist for the agent that ran the parent; a child switched to another agent would have nothing to fork from.

## Risks / Trade-offs

- **Cost of the first turn in a child**: up to the budget, once per agent session. Agents cache prompts; the budget caps the rest.
- **The first link is the origin**: a node later linked under a second parent still inherits from the first. Stated, and matches how the graph is drawn.

## Migration Plan

None. The origin is read from existing columns.
