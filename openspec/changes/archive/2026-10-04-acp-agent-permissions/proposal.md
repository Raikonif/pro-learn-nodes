> **Resumed 2026-10-03.** Split from `acp-agent-permissions-and-branching`: branching on agent backends shipped as `node-branch-inheritance`, and file attachments are left to a later change. Picked up because the permission modes `agent-session-controls` offers are not honest while every request is refused — a mode described as asking before acting in fact never lets the agent act.

## Why

`acp-agent-backend` makes a node conversation run on an agent the learner already pays for, but answers every permission request with a refusal. `agent-session-controls` then offered the agent's permission modes, each described by what it allows — and in the mode the learner is steered toward, asking before acting, the agent can explain but never act, because nobody is asked. Today the only way to let an agent write a file or run an exercise is a mode that acts without asking. The safe choice and the useful one should be the same choice.

The node's working directory already exists and holds the practice the learner is working on, but nothing states what an agent may reach there, and deleting an account leaves those directories behind.

## What Changes

- Add the **permission prompt**. A request the learner has not pre-decided is presented inline in the conversation it came from, and a **workspace-level indicator** surfaces requests for nodes that are not on screen, so a turn never waits on a request nobody can see. This replaces `acp-agent-backend`'s refuse-and-record fallback for every request a prompt can decide.
- **Auto-decide reads** inside the node's own directory; ask for writes, anything outside it, and every execution.
- **Remember decisions** for one kind of action in one node, reviewable and revocable, never crossing agents or accounts.
- State what a node's **working directory** holds and bounds, and **remove an account's node directories when the account is deleted**. Archiving a node keeps its directory.

## Capabilities

### New Capabilities

- `agent-tool-permissions`: how an agent's request to act is presented, decided, and remembered, and what is auto-decided without asking.

### Modified Capabilities

- `node-agent-sessions`: the working directory's contents, bounds, and lifetime.

## Impact

- **Backend**: `service/agent/permissions.py` (policy + remembered decisions), a pending-request registry the streaming route and a decision route share, `repository/permission_repo.py`, one migration for remembered decisions. `service/agent/acp/agent.py` answers `session/request_permission` from the registry instead of refusing; refusal remains only for a request that arrives outside any turn. `service/profile_service.py`'s account deletion removes the account's node directories.
- **Frontend**: `features/node-chat/` gains the inline prompt; the workspace shell gains the pending-request indicator; `features/settings/` gains the review-and-revoke list. The session controls' note that a mode which asks is "effectively read-only" (backend `service/agent/controls.py`, frontend `features/node-chat/session-controls.ts`) no longer holds and is corrected.
- **Depends on**: `acp-agent-backend`, `agent-session-controls`.
