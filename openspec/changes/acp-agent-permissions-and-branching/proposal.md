> **Split 2026-10-03:** branching on agent backends moved to `node-branch-inheritance`. This change keeps the permission surface and the node directory's attachments, and is deferred until a case arises that the practice rail and the context server do not cover — agents now deliver practice through MCP without touching the learner's system.

## Why

`acp-agent-backend` makes a node conversation run on an agent the learner already pays for, but deliberately stops short in three places. Every permission request is refused, so an agent can explain but never act — no file written, no exercise run in the sandbox. A node's working directory is empty, so the agent cannot read what the learner attached. And a node branched from an agent conversation starts with no memory of its parent, which breaks the graph's central promise: that a branch inherits the conversation it grew from.

## What Changes

- Add the **permission prompt**. A request the learner has not pre-decided is presented inline in the conversation it came from, and a **workspace-level indicator** surfaces requests for nodes that are not on screen, so a turn never waits on a request nobody can see. This replaces `acp-agent-backend`'s refuse-and-record fallback for every request a prompt can decide.
- **Auto-decide reads** inside the node's own directory; ask for writes, anything outside it, and every execution.
- **Remember decisions** at a scope the learner chooses, reviewable and revocable, never crossing agents or accounts.
- Place a node's **attachments in its working directory**, and remove the directory with the node.

## Capabilities

### New Capabilities

- `agent-tool-permissions`: how an agent's request to act is presented, decided, and remembered, and what is auto-decided without asking.

### Modified Capabilities

- `node-agent-sessions`: adds the working directory's contents and lifetime.

## Impact

- **Backend**: `service/agent/permissions.py` (policy + remembered decisions), a pending-request registry the streaming route and a decision route share, `repository/permission_repo.py`, one migration for remembered decisions. Node deletion removes the node directory; attachment storage moves into it.
- **Frontend**: `features/node-chat/` gains the inline prompt; the workspace shell gains the pending-request indicator; `features/settings/` gains the review-and-revoke list.
- **Depends on**: `acp-agent-backend`.
