## Why

A node conversation cannot yet reach a model. `POST /workspace/messages` persists a message and stops; there is no streaming route, no provider, and no way for the learner to get an answer. Phase 4 planned to close this with BYOK API keys, which bills per token and requires the learner to hold a key at all.

Meanwhile the learner already pays for a ChatGPT subscription, and the vendor already ships a client that authenticates against it. The Agent Client Protocol — the open standard JetBrains and Zed co-develop, now with an agent registry shipped into their IDEs — is how an application connects to that client without handling its credentials. Codex and Claude Code are reachable through it today. Google's is not: see `agy-antigravity-agent`.

This change makes a node conversation live by connecting an external agent over ACP, so the app becomes usable at zero marginal cost and before any API key exists.

## What Changes

- Introduce an **`Agent` contract** for session-stateful backends, standing beside the planned `Provider` contract for stateless ones. Both are defined here; only `Agent` is implemented. They differ in who owns the conversation loop, and that difference is load-bearing rather than incidental — see design.
- Implement **ACP** as the one `Agent` transport: spawn the agent as a subprocess, negotiate capabilities at `initialize`, and drive `session/new` and `session/prompt` over JSON-RPC on stdio.
- **Agents are configured, not bundled.** The learner names a command to run; the agent binary is one they already installed and already authenticated. Nothing about a subscription's credentials enters this application.
- Map a **node to an agent session**, and keep the conversation continuous across an application restart even though the agent's session lives in a subprocess that does not survive one.
- Give each node an empty **directory** as the agent's working directory, created lazily, because `session/new` requires one. Placing attachments in it is `acp-agent-permissions-and-branching`.
- **Answer every permission request.** `session/request_permission` is a required client method and an unanswered one hangs the turn. Here every request is refused and the refusal is recorded in the conversation; the prompt surface that lets the learner grant it is `acp-agent-permissions-and-branching`.
- Let the learner mark a **default agent** per account, so a new node needs no backend decision before its first message.
- Add the **streaming route** the conversation needs: `session/update` notifications become server-sent events, so a turn renders as it arrives rather than on completion.
- Record which backend a node runs on as part of **node configuration**, alongside mode, active skills, and MCP servers — inherited by child nodes and by threads on the same terms.
- **Compaction and inference-time skill merging are declared unavailable on agent backends**, and the workspace says so. An agent manages its own context and will not yield the drillable `CompactionStep` records the mission promises. Faking them would be worse than their absence.

## Capabilities

### New Capabilities

- `agent-backends`: the contract for a session-stateful conversation backend — configuring one, negotiating what it can do, reporting whether it is authenticated and reachable, and degrading legibly when it is not.
- `node-agent-sessions`: how a node's conversation maps onto an agent-owned session, including continuity across restarts. What a branch means when the agent holds the thread is added by `acp-agent-permissions-and-branching`.
- `conversation-streaming`: a turn arriving incrementally at the workspace, including cancellation and the failure of a turn in progress.

### Modified Capabilities

- `node-chat-threads`: a node's configuration — which threads inherit and cannot override — now includes the conversation backend.
- `node-creation-controls`: a child node inherits its parent's conversation backend along with mode, skills, and MCP servers.

## Impact

- **Backend**: new `service/agent/` (the `Agent` contract, the ACP client, subprocess lifecycle, session mapping), `service/provider/` (the `Provider` contract, defined only), `repository/agent_repo.py`, `api/routes/agents.py` for registration and the connection test, `api/routes/chat.py` for the streaming turn and cancellation. `models/workspace.py` gains the node's backend selection; one Alembic migration.
- **Dependency**: none. The ACP client is written against the protocol directly (see design); the `agent-client-protocol` SDK is not adopted.
- **Frontend**: `features/node-chat/` gains the live turn, the streaming consumer, and the visible record of refused permission requests; `features/settings/` gains agent configuration and a connection test.
- **Process model**: the backend now spawns and supervises child processes it did not previously. Agent processes must not outlive the backend, and `--reload` must not accumulate them — the same orphan class `scripts/backend.mjs` already documents for the backend itself.
- **Roadmap**: this is Phase 4a, ahead of Phase 4's BYOK providers, and it delivers the streaming path Phase 7 assumed would already exist.
- **Not in scope**: the permission prompt, per-node attachments, and branching on agent backends, which are `acp-agent-permissions-and-branching`; the ACP agent registry (browse-and-install), which is the full JetBrains experience but is polish on a working connection; the BYOK `Provider` adapters, which remain Phase 4; and compaction on agent backends, which is declared unavailable rather than deferred.
