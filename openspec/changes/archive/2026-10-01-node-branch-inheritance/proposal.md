## Why

Branching is the idea the product rests on — a new session grows from a passage of an earlier one and inherits it — but on agent backends a branch inherits nothing. A child node's thread has no agent session yet, so its first turn opens a fresh one and replays *that thread's* history, which is empty. The agent in the child does not know what the parent was about, or which passage the learner branched from. The same is true of a side thread spawned from a passage on the same node.

## What Changes

- **A branched node's first turn carries its parent's conversation** up to and including the message the branch was made from, with the selected passage named as the reason for the branch. A whole-node child (no passage) carries the parent's conversation as it stood when the child was created.
- **A side thread spawned from a passage does the same** with the main thread of its own node.
- The inherited context is sent **once**, when the child's agent session is first opened; after that the child's own session holds it, and the application's existing per-agent catch-up and replay keep working unchanged.
- **The child's record starts empty and shows where it came from**: a line at the top of the conversation names the parent and the passage, and leads back to it.
- Large parents are **bounded**: the inherited transcript keeps the most recent messages that fit a fixed budget, and says that earlier ones were left out.
- Branching takes **no agent-specific path**. Both measured agents report `session/fork`, but a fork copies a session as it stands and cannot be cut at a passage; the fresh-session-plus-transcript primitive works on every agent and cuts exactly.

## Capabilities

### Modified Capabilities

- `node-agent-sessions`: a node or thread created from another conversation starts with that conversation up to the branch point as context.

## Impact

- **Backend**: `service/agent/sessions.py` — when a thread's first agent session is opened, resolve its origin (the node link that created the node, or the thread's own anchor) and prepend the inherited transcript; `service/workspace.py` gains a bounded "conversation up to a message" read.
- **Frontend**: `features/node-chat/` — an origin line at the top of a branched node's or thread's conversation, linking to the parent passage.
- **Splits from** `acp-agent-permissions-and-branching`, which keeps the permission surface and is deferred.
- **Not in scope**: inheriting from grandparents (only the immediate parent's conversation is carried; the parent's own agent already holds what it inherited), and native `session/fork`.
