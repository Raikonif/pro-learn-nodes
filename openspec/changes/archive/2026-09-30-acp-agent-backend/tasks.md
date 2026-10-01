## 0. Preconditions

- [x] 0.1 Record the green baseline: `uv run pytest` in `backend/`, `pnpm test` and `pnpm run typecheck` in `frontend/`. All must pass before any file changes — otherwise a later failure cannot be attributed.
- [x] 0.2 Confirm the spike still holds: `codex login status` reports ChatGPT, `claude auth status` reports `loggedIn: true`, and the pinned adapters (`@agentclientprotocol/codex-acp@2.0.1`, `@agentclientprotocol/claude-agent-acp@0.84.0`) resolve on npm. If an adapter moved again, update design.md's Spike results before continuing.

## 1. Test harness: a fake ACP agent

- [x] 1.1 Create `backend/tests/fixtures/fake_acp_agent.py`: a standalone script speaking newline-delimited JSON-RPC on stdio, implementing `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`, with behavior selected by CLI flags: `--chunks N`, `--request-permission`, `--crash-mid-turn`, `--no-load-session`, `--unauthenticated`, `--hang`
- [x] 1.2 The fake agent persists sessions to a directory passed by flag, so `session/load` in a fresh process recalls prior turns — the property the spike measured on real agents
- [x] 1.3 Add a `fake_agent_command` pytest fixture in `conftest.py` returning the argv for `sys.executable fake_acp_agent.py ...`
- [x] 1.4 Add an opt-in `@pytest.mark.real_agents` smoke test (skipped unless `LEARN_NODES_REAL_AGENTS=1`) porting the spike: initialize → prompt → restart → load → recall, against both real agents

## 2. Contracts

- [x] 2.1 Write `backend/service/agent/contract.py`: the `Agent` protocol (session-stateful: `open_session`, `load_session`, `prompt` → `AsyncIterator[TurnEvent]`, `cancel`) and the `TurnEvent` union (text chunk, thought chunk, tool call, tool call update, plan, permission refused, usage, turn ended with outcome)
- [x] 2.2 Write `backend/service/provider/contract.py`: the `Provider` protocol (stateless: `stream_chat(messages, tools, model, skills)`), defined only — no implementation, per design
- [x] 2.3 Write `backend/service/agent/capabilities.py`: the feature-availability table stating compaction and inference-time skill merging are unavailable on session-stateful backends, with a test asserting both kinds are covered

## 3. ACP client (TDD against the fake agent)

- [x] 3.1 Write failing tests `backend/tests/test_acp_client.py` for: negotiation returns reported capabilities and agent info; a turn yields text chunks in order then `end_turn`; unknown `sessionUpdate` kinds are ignored, not raised
- [x] 3.2 Implement `backend/service/agent/acp/wire.py`: Pydantic models for exactly the used subset (initialize, session/new, load, prompt, cancel, update, request_permission)
- [x] 3.3 Implement `backend/service/agent/acp/connection.py`: subprocess spawn, stdout reader task, id-correlated requests, agent→client request dispatch, stderr drained to the log so a full pipe never blocks the agent
- [x] 3.4 Answer `session/request_permission` with `cancelled` and emit a permission-refused `TurnEvent` naming the tool call; test with `--request-permission`
- [x] 3.5 Advertise no `fs` or `terminal` client capability; answer any agent→client method not implemented with JSON-RPC `-32601`, never leave it pending (test with an unexpected method)
- [x] 3.6 Implement `session/cancel`: test that cancelling after partial chunks yields a `cancelled` outcome and the connection accepts a new prompt immediately
- [x] 3.7 Detect process exit and read timeouts: test with `--crash-mid-turn` and `--hang` that the turn ends `failed` with the reason, and chunks already yielded are kept
- [x] 3.8 Implement `backend/service/agent/acp/agent.py` adapting the connection to the `Agent` contract

## 4. Process supervision

- [x] 4.1 Write `backend/service/agent/supervisor.py`: one connection per (account, agent registration), lazily started, tracked in `RuntimeState` beside `indexing_task`
- [x] 4.2 Terminate every tracked agent in `local_data_lifespan` shutdown (terminate, then kill after a grace period); test that no fake-agent PID survives lifespan exit
- [x] 4.3 Start agents in their own process group and kill the group, so an `npx` wrapper's child does not orphan; test with a fake agent that forks a child
- [x] 4.4 Guard development reloads: record spawned agent PIDs in the local data dir and reap stale ones at startup; test that repeated lifespan start/stop cycles do not grow the process count
- [x] 4.5 A crashed connection is dropped from the supervisor and respawned on the next turn

## 5. Persistence

- [x] 5.1 Add `AgentRegistrationRecord` to `backend/models/` (profile-owned: name, command, args JSON, env JSON, is_default) with a partial unique index enforcing one default per profile
- [x] 5.2 Add `backend_agent_id` (nullable) to `WorkspaceNodeRecord`; add `agent_id` + `agent_session_id` (nullable) to `ChatThreadRecord`; add `outcome` (nullable: completed/cancelled/refused/failed) and `kind` (message, tool activity, permission refused, continuity seam) to `ChatMessageRecord`
- [x] 5.3 Write the Alembic migration `backend/migrations/versions/20260930_01_agent_backends.py`; test upgrade from the current head on a populated database leaves existing nodes with no backend and existing messages unchanged
- [x] 5.4 Write `backend/repository/agent_repo.py` with `test_agent_repo.py`: register, list, set default, remove — every query scoped by profile; test that another profile's registrations are invisible

## 6. Agent registration service and routes

- [x] 6.1 Write `backend/service/agent/registry.py` with tests: registration launches and negotiates the command before saving it, and refuses with the underlying error when it cannot launch
- [x] 6.2 Implement the connection test returning a staged result (`launch` / `negotiate` / `authenticate`) plus agent info and capabilities; test each failing stage with the fake agent's flags; assert no node, thread, or message is created
- [x] 6.3 Report an unauthenticated agent as such, with its advertised `authMethods` as guidance text only — never an input for a credential
- [x] 6.4 Add `backend/api/routes/agents.py`: `GET/POST/DELETE /agents`, `PUT /agents/{id}/default`, `POST /agents/{id}/test`, all behind the account dependency in `api/dependencies/auth.py`; route tests including the cross-account refusal being identical to not-found
- [x] 6.5 Ship suggested presets (Codex, Claude; Google excluded — see design Spike results) as data the settings UI offers to prefill — commands only, editable, never auto-registered
- [x] 6.6 Removing a registration leaves every conversation that ran on it readable (test)

## 7. Node sessions and the streaming turn

- [x] 7.1 Write `backend/service/agent/sessions.py`: resolve a node's backend (node's own, else the default, recorded on the node at first turn); refuse with a directing error when none is registered, after the message is recorded
- [x] 7.2 Create the node's working directory lazily under the local data dir (`agent-workspaces/<node_id>/`), never inside the data store; test it is empty and not a parent of another node's
- [x] 7.3 Open or continue the thread's session: `session/load` when the recorded session belongs to the same agent and `loadSession` was reported; discard the replayed updates; otherwise replay
- [x] 7.4 Implement the replay primitive: `session/new`, then the recorded transcript rendered as context in the first prompt; record a continuity-seam message; test with `--no-load-session`, and with a switched agent
- [x] 7.5 Record content as it arrives: the assistant message is created at turn start and updated per chunk batch, so a dropped connection leaves partial content marked incomplete (test by abandoning the stream mid-turn)
- [x] 7.6 Add `backend/api/routes/chat.py`: `POST /chat/turn` (thread id + text) streaming SSE events mapped from `TurnEvent`, and `POST /chat/turns/{turn_id}/cancel`; test event order, outcome recording, and that two nodes on the same agent never see each other's messages
- [x] 7.7 Inheritance: a child node and a thread take the parent node's `backend_agent_id`; extend the existing creation tests, including a parent whose backend is not installed (child created with the same backend, failure reported on turn)

## 8. Frontend: settings

- [x] 8.1 Add `features/settings/agents-api.ts` (+ test) for the agents routes
- [x] 8.2 Build the agents settings panel: list, add from preset or custom command, set default, remove, and a Test button showing the staged result — failure names its stage (component tests)
- [x] 8.3 An unauthenticated result shows the agent's own login instruction (e.g. `codex login`, `claude` → `/login`) as text, with no credential field anywhere (test asserts no password/text input for secrets)

## 9. Frontend: live conversation

- [x] 9.1 Add an SSE consumer in `shared/lib/` for POST-initiated streams (fetch + ReadableStream, since `EventSource` cannot POST), with tests over a mocked stream
- [x] 9.2 `features/node-chat/`: render the assistant turn incrementally; render tool activity and plans as distinguishable entries; render permission-refused and continuity-seam entries (component tests)
- [x] 9.3 A Stop control cancels the turn; partial content stays, marked incomplete; the composer is usable immediately (test)
- [x] 9.4 Show turn outcome (failed / cancelled / refused) distinctly from a completed answer; on reopening a node, render recorded incomplete turns as such
- [x] 9.5 Show the node's backend in the conversation header; when it is session-stateful, state that compaction and skill merging are unavailable on it and why, with no control that approximates them
- [x] 9.6 With no agent registered, sending records the message and shows a link to agent settings

## 10. Verification

- [x] 10.1 Playwright spec against the fake agent (backend started with its command registered): register agent → create node → send → text streams → stop → reopen shows incomplete turn
- [x] 10.2 Verify SSE across the production transport: build the sidecar, run the app via `pnpm tauri build` output, and confirm a turn streams over the Unix socket. If it does not, record the finding in design.md Open Questions and fix before archiving
- [x] 10.3 Manual demo with real subscriptions: register Codex and Claude from presets, test both, chat in a node on each, restart the app, continue the conversation — the model recalls earlier context
- [x] 10.4 Run `LEARN_NODES_REAL_AGENTS=1 uv run pytest -m real_agents` once and record the adapter versions it passed against in design.md
- [x] 10.5 Update `openspec/roadmap.md`: insert Phase 4a (this change) and 4b (`acp-agent-permissions-and-branching`) ahead of Phase 4, and note Phase 7 inherits the streaming route
- [x] 10.6 Full suites green: `uv run pytest`, `pnpm test`, `pnpm run typecheck`
