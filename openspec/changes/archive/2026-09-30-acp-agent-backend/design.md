## Context

`tech-stack.md` specifies one abstraction for reaching a model:

```python
async def stream_chat(messages, tools, model, skills) -> AsyncIterator[ChunkEvent]
```

That signature requires the application to hand over the full message list on every turn. It is not incidental — it is what makes fork points, corrections, and drillable compaction possible, and principles 4, 8, and 9 of the mission all rest on it.

Reaching a ChatGPT subscription cannot preserve it. There are four routes, and the ownership of the conversation loop is the axis they differ on:

| Route | Loop owner | Cost |
|---|---|---|
| Read `~/.codex/auth.json`, call the ChatGPT backend directly | application | undocumented private endpoint, another app's credential file, the consumer-terms question `roadmap.md` already flags |
| ACP over stdio | agent | session-stateful; agent's world is a working directory |
| `codex mcp-server` | agent | makes the agent a tool nested inside an outer agent that still needs a provider |
| `codex exec --json` | agent | one-shot; full context re-sent every turn; Codex-only |

Only the first preserves application ownership, and it is the only one carrying legal and stability risk. That is not a coincidence: you can have "the application owns the loop" or "the vendor owns the auth," not both.

ACP is the route this change takes, and the model is the one JetBrains and Zed already ship. Their framing is the honest one: *each agent maintains its own models, behavior, authentication, and agent-side tools.*

Verified by spike on 2026-09-30: `codex-cli 0.154.0` logged in with ChatGPT and `@agentclientprotocol/codex-acp` 2.0.1; Claude Code 2.1.285 logged in with claude.ai and `@agentclientprotocol/claude-agent-acp` 0.84.0. Codex has no `codex acp` subcommand — the adapter is the route.

The `@zed-industries/*` adapters named when this design was first written are **deprecated** — both were renamed into the `@agentclientprotocol` organisation. That the recommended launch commands moved within a month is the strongest argument yet for configuring agents by command rather than encoding them.

### Spike results

A raw JSON-RPC client (initialize → `session/new` → `session/prompt` → terminate → `session/load` in a fresh process → prompt) against both agents:

| | codex-acp 2.0.1 | claude-agent-acp 0.84.0 |
|---|---|---|
| Turn over subscription auth | `end_turn`, 5.9s | `end_turn`, 2.6s |
| `loadSession` | reported | reported |
| Context survives a process restart | yes (recalled a fact) | yes (recalled a fact) |
| `session/load` replays history as updates | yes | yes |
| `sessionCapabilities` | `resume, list, close, delete, fork, additionalDirectories` | same |
| `authMethods` | `api-key`, `chat-gpt` | none (auth is Claude Code's own) |
| Session reports models / modes | both | modes |

**Google, measured the same day.** `@google/gemini-cli@0.62.0 --acp` launches and negotiates in ~5s (`--experimental-acp` is deprecated, and did not answer `initialize`). But `session/new` over a personal Google sign-in is refused by Google itself: *"This client is no longer supported for Gemini Code Assist for individuals… migrate to the Antigravity suite."* Antigravity's CLI, `agy` 1.2.14, has no ACP mode — its only machine interface is `--print --input-format stream-json`. So no ACP route reaches a Google subscription today, and no Google preset ships: a preset that can only fail at `authenticate` for the learner it exists for is worse than none. A learner with a Gemini API key can still register Gemini CLI as a custom command. Reaching the subscription through `agy` is the deferred change `agy-antigravity-agent`.

Usage and quota arrive in the `session/prompt` result's `usage` and `_meta.quota`, which makes per-turn cost displayable without any provider API.

## Goals / Non-Goals

**Goals**

- A node conversation that runs on an agent the learner already installed and already authenticated, with no API key and no credential handled here.
- Both contracts — `Agent` and `Provider` — defined together, so the seam between them is designed rather than discovered when BYOK lands.
- The graph stays the application's: persistent, branchable, readable with no agent present.
- Honest degradation: features that require application-assembled context are declared unavailable on agent backends.

**Non-Goals**

- Implementing `Provider`. It is defined here and implemented in Phase 4.
- The ACP agent registry. Browse-and-install is the full JetBrains experience and is polish on a working connection.
- Bundling any agent. The learner installs and authenticates it; this application spawns it.
- Handling any subscription credential, by any route. Reading `~/.codex/auth.json` is out of scope permanently, not deferred.
- Compaction on agent backends. Declared unavailable, not postponed.

## Decisions

### Two contracts, because the difference is real

The tempting move is one `Provider` protocol with ACP squeezed behind it. It fails on the first turn: a `Provider` is handed `messages` and an `Agent` is handed only what is new, and an adapter bridging that gap must either replay the whole transcript every turn — paying full token cost with no prompt caching, forever — or quietly drop context the caller believed it had passed.

Two contracts state the difference instead of hiding it. Everything above them treats a backend as one or the other and asks which it is, exactly as `identity-providers` made mechanism-specific concerns invisible to enrollment by refusing to let any of them into `Identity`.

Both are written in this change even though only one is implemented, because a seam designed against a single implementation is a seam shaped by that implementation.

### ACP lives in Python, in the service layer, as a thin client of our own

The client sits in `service/agent/acp/`, under the `api → service → repository → models` rule, so the bundle needs no Node runtime.

It is written directly against the protocol rather than adopting the `agent-client-protocol` PyPI package (0.12.1 at the time of the spike). The spike's client was ~100 lines of newline-delimited JSON-RPC over asyncio subprocess pipes and negotiated with both current agents. The subset this change uses — `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/update`, `session/request_permission` — is small and stable, and owning it removes the two risks the SDK carried: PyInstaller bundling of a young dependency, and a 0.x version pin coupling the application to the SDK's release cadence rather than the protocol's. Wire shapes are modelled as Pydantic types for exactly that subset; unknown update kinds are ignored, not rejected, so a newer agent never breaks a turn.

### Agents are configured, never bundled or credentialed

The learner supplies a command. The agent binary is theirs, installed and authenticated by them. No credential is requested, stored, read, or transmitted here.

This is the load-bearing property of the whole change. It is what keeps `roadmap.md`'s consumer-terms warning satisfied — the subscription is used by the client the vendor shipped for it — and it is why reading `~/.codex/auth.json` is a permanent non-goal rather than a shortcut held in reserve. It also means the bundle does not grow, and an agent added to the ecosystem is reachable without shipping an update.

### The application's transcript is authoritative; the agent's session is a cache

An agent session lives in a subprocess. It does not survive a restart, a crash, or `--reload`. The graph must survive all three.

So every message is recorded as it arrives, and the record is what a node renders. The agent session is a performance and continuity optimisation over that record, never the source of truth. This is what lets a node whose agent is not installed still open and read in full, and it is what makes an agent crash a reported interruption rather than lost work.

### Session revival: load when reported, replay otherwise

Continuing a conversation after a restart has two possible mechanisms:

- `session/load`, where supported. Cheap. But it is an **optional** capability reported at `initialize`, so it cannot be assumed.
- `session/new` followed by re-establishing context from the recorded transcript. Always works, costs a full context pass.

The design is: probe `loadSession` during negotiation, use it when present, fall back to replay when absent. Which path a given agent takes is invisible in the spec on purpose — `node-agent-sessions` requires that the conversation continues and that a broken continuity is *visible*, not which mechanism achieved it.

The spike measured it: both `codex-acp` and `claude-agent-acp` report `loadSession`, and a fact stated before a process restart was recalled after `session/load` in a fresh process. Load is therefore the common path. Replay remains for agents that do not report it (none of the presets today) and for a load that fails — for example, the agent's own session store having been cleared.

`session/load` replays the session's history as `session/update` notifications. Those are discarded, never recorded: the application's transcript already holds them, and recording them again would duplicate the conversation.

Replay is built as one primitive — *open a fresh session and hand it a recorded transcript as context* — because `acp-agent-permissions-and-branching` needs exactly the same primitive to start a branched child from its parent's conversation up to the branch point.

### A device-wide default is per account

Registered agents and the default are owned by the account, like every other workspace datum. A root node created with no explicit backend runs on the default; a node's backend can be changed afterwards. This keeps a settings decision out of the way of a learner who wants to start writing, which is the question the first draft left open.

### Permissions in this change: always answered, visibly refused

The prompt surface is `acp-agent-permissions-and-branching`. Until it exists, every `session/request_permission` is answered with a refusal, and the refusal is recorded in the conversation naming what was asked. A request is never left pending, so a turn never hangs; and it is never silently decided, so the learner can see what the agent wanted. Reading works regardless: the agents read inside their working directory with their own tools, and this change advertises no `fs` or `terminal` client capability.

Each node already gets its working directory here (created lazily, empty) because `session/new` requires one. Placing attachments in it and removing it with the node belong to the second change.

### Compaction is unavailable on agent backends, and says so

An agent compacts on its own schedule and will not hand back `CompactionStep` records. Approximating them — summarising the transcript locally and presenting the result as the drill-down the mission promises — would produce a feature that looks like principle 9 and is not.

Declaring it unavailable is the honest option and the one that keeps the two contracts meaningful. The product framing carries it: bring your own key for the full experience, or bring your own agent for zero marginal cost with fewer features.

### Streaming is SSE, as already chosen

`tech-stack.md` chose SSE over WebSocket because streaming is unidirectional. ACP's `session/update` notifications map onto it directly.

The permission request is the one place that is genuinely bidirectional, and it does not change the choice: the request goes out over the SSE stream, and the learner's answer arrives as an ordinary request on its own route. Adding a WebSocket for one message per turn would be a large change to the transport for a small change in shape.

### Agent processes are supervised the way the backend already is

`scripts/backend.mjs` documents the orphan problem in detail: a process tree that is not flat leaks servers across restarts, and those servers hold ports that later allocations skip past because they only *look* taken. The backend is now the parent of agent processes and inherits that hazard.

Agents are therefore tracked explicitly, terminated in the lifespan's shutdown path alongside `runtime.indexing_task`, and — because `--reload` restarts the process without unwinding cleanly in every case — a development restart must not accumulate them.

## Interfaces

The HTTP surface, fixed before implementation so the backend and frontend are built against the same shapes. All JSON is camelCase, all routes sit behind the account dependency, and a resource of another account is answered exactly as one that does not exist (404).

### Agents

- `GET /agents` → `{ agents: Agent[], presets: Preset[] }`
  - `Agent = { id, name, command, args: string[], env: Record<string,string>, isDefault: boolean }`
  - `Preset = { key: "codex"|"claude", name, command, args: string[], loginHint }` — data to prefill a form, never registered automatically
- `POST /agents` `{ name, command, args?, env? }` → `Agent`. Launches and negotiates before saving; on failure `422 { detail: { stage, message } }`. The first registration becomes the default.
- `DELETE /agents/{id}` → `204`
- `PUT /agents/{id}/default` → `Agent`
- `POST /agents/{id}/test` → `ConnectionTest = { ok, stage: null|"launch"|"negotiate"|"authenticate", message: string|null, agent: {name,title,version}|null, capabilities: { loadSession: boolean }|null, authMethods: {id,name,description}[] }`. Creates no conversation material.

### Node backend

- Bootstrap `graph.nodes[]` gains `backendAgentId: string|null`.
- Bootstrap `graph.messages[]` gains `kind: "message"|"tool"|"permission_refused"|"continuity_seam"` and `outcome: null|"incomplete"|"completed"|"cancelled"|"refused"|"failed"`. A learner message has `outcome: null`. An agent message is `"incomplete"` from the moment its turn starts until the turn ends — so a turn whose connection dropped reads as incomplete on reopening.
- `PUT /workspace/nodes/{id}/backend` `{ agentId }` → bootstrap.

### The streaming turn

`POST /chat/turn` `{ threadId, text }` → `text/event-stream`. Each event has an `event:` name and a JSON `data:` line:

| event | data |
|---|---|
| `turn.started` | `{ turnId, threadId, learnerMessageId, agentMessageId }` |
| `text` | `{ text }` — append to the agent message |
| `thought` | `{ text }` |
| `tool` | `{ messageId, toolCallId, title, kind, status }` — recorded as a `kind: "tool"` message |
| `plan` | `{ entries: { content, status }[] }` |
| `permission.refused` | `{ messageId, title }` |
| `continuity.seam` | `{ messageId, reason }` |
| `usage` | `{ inputTokens, outputTokens, totalTokens, model }` |
| `turn.ended` | `{ outcome, reason }` — always last |

When the turn cannot be attempted at all — no agent registered, or the node's agent unreachable — the learner message is still recorded and the stream carries `turn.started` then `turn.ended` with `outcome: "failed"` and a `reason` of `"no_agent"`, `"not_authenticated"`, or `"unreachable"`, plus a human message in `detail`.

`POST /chat/turns/{turnId}/cancel` → `204`. The stream then ends with `turn.ended { outcome: "cancelled" }`.

## Risks / Trade-offs

- **Consumer terms.** `roadmap.md` requires verifying each provider's consumer terms before shipping its adapter. This change's position is that spawning the vendor's own authenticated client and speaking a published protocol to it is materially different from presenting a subscription credential to a private endpoint. That position should be confirmed against Codex's and Claude Code's terms before release, not assumed.
- **Scope.** This is the largest change in the project so far: two contracts, a subprocess protocol client, a streaming route that does not yet exist, a permission surface, and a migration. Splitting it — contracts and connection first, streaming and permissions second — is worth considering, though a connection that cannot stream a turn demos nothing.
- **ACP is young and moving.** The protocol, the Python SDK, and the agent adapters all version independently. Capability negotiation is what limits the blast radius; a hard version pin plus a connection test that names the failing stage is what makes a break diagnosable.
- **Node.js is required after all — on the learner's machine, not in the bundle.** `codex-acp` and `claude-code-acp` are npm packages. The bundle stays small, but "install the agent" is a real prerequisite, and the connection test must say so clearly when the command will not launch.
- **A per-node directory is a new on-disk structure** that must be created, scoped, and removed with the node. Getting removal wrong leaks the learner's attachments after deletion.
- **Building the streaming path here means Phase 7 inherits it** rather than defining it. If Phase 7's requirements diverge, this change's shape constrains them.

## Migration Plan

One additive migration: an account-scoped `agent_registrations` table (name, command, args, env, is-default), a nullable backend reference on `workspace_nodes`, the agent session per thread (agent id + session id, since a session id means nothing to a different agent), and a turn outcome on `chat_messages`. Existing nodes have no backend. A node's backend is resolved from the default on its first turn and **recorded on the node**, so later changing the default never silently moves an existing conversation to a different agent. With no agent registered at all, the message is recorded and the learner is directed to settings — the same state as a node whose agent is not installed, needing no separate handling.

When a thread's recorded session belongs to a different agent than the node's current backend (the learner switched it), the session is not loaded; the conversation is re-established by replay, and the seam is shown.

*Superseded by `local-sessions-and-history`:* a thread now keeps one session per agent (`agent_sessions`, with a `synced_through` watermark). Returning to an agent continues its own session and sends only what it missed; replay is left for an agent with no session for the thread, or one that cannot be loaded.

Per-node directories are created lazily on first use, so no bulk filesystem operation runs at upgrade.

No existing route changes shape. `POST /workspace/messages` keeps persisting a message; the streaming turn is a new route beside it.

## Open Questions

Resolved:

- **Does `codex-acp` report `loadSession`?** Yes, and so does `claude-agent-acp`; measured, see Spike results.
- **How is an agent selected?** An account-scoped default, overridable per node.
- **Raw transcript or summary for re-establishment?** Raw. A summary would be the compaction this change declares unavailable.
- **Where does the permission prompt live?** Both inline and in a workspace-level indicator — decided, and delivered by `acp-agent-permissions-and-branching`.
- **Does the SDK survive PyInstaller?** Moot: the client is our own, with no new runtime dependency.
- **Scope.** Split in two, as the Risks section proposed: this change connects, streams, and continues; the second adds the permission surface, per-node attachments, and branching.

Still open, not blocking tasks:

- **Does SSE survive the production transport?** It did not. The Tauri host's `api_request` read every response to its end and parsed it as JSON, so a turn would have rendered nothing until the agent finished — and every `204` (removing an agent, cancelling a turn) failed as invalid JSON. Fixed in `src-tauri/src/lib.rs`: a second command, `api_stream`, forwards the body over a Tauri `Channel` as it is read, requesting HTTP/1.0 so uvicorn delimits the body by closing the connection rather than chunk-encoding it (verified against a real uvicorn on a Unix socket: events arrived at 0.0s, 0.5s, 1.0s); an empty success body is `null`; a refusal keeps its body, which the frontend rebuilds into the same `ApiHttpError` the web transport throws. Still unverified: a turn streaming inside a built `.dmg`, which needs a manual run.

Verified against real agents on 2026-09-30 (`LEARN_NODES_REAL_AGENTS=1 uv run pytest -m real_agents`): `@agentclientprotocol/codex-acp@2.0.1` and `@agentclientprotocol/claude-agent-acp@0.84.0` — launch, prompt, fresh process, `session/load`, recall — both passed.
- **Google.** Measured and excluded — see Spike results. Tracked as `agy-antigravity-agent`.
