## 1. Contract and ACP client

- [x] 1.1 Record the shapes: capture `usage_update` and `config_option_update` payloads from one short real turn per agent (opt-in, like `real_agents`) and write them into design.md
- [x] 1.2 Tests first (fake ACP agent gains `--config-options` with `model`, a `thought_level`, `mode`, and a fast option; honours `session/set_config_option`; echoes the active model and mode in replies; sends `available_commands_update` after `session/new` and `usage_update` during a turn): `config_options` after new and load; `config_option_update` refreshes them; `set_config_option` changes the next turn; available commands are kept per session; method-not-found surfaces clearly
- [x] 1.3 Add `ConfigOption`, `AvailableCommand`, `config_options`, `available_commands`, `set_config_option` to the `Agent` contract and `AcpAgent`; forward usage as a `ContextUsage` turn event; extend the in-memory `FakeAgent`

## 2. Persistence and discovery

- [x] 2.1 Migration: `workspace_nodes.agent_settings`, `agent_registrations.offered_options`, `agent_registrations.offered_commands` (nullable JSON); test existing rows unchanged
- [x] 2.2 Record the offer (categories `model`, `thought_level`, `mode`, `model_config`) and commands whenever a session opens and from the connection test; `GET /agents/{id}/offer` → `{ model, effort, fast, mode: { values: [{ value, name, group }] }, commands }`, account-scoped; permission groups per design, unknown values in the most permissive group; tests

## 3. Applying choices

- [x] 3.1 Tests first (`FakeAgent`): settings applied after open, load, and continue, only where they differ; a value no longer offered is skipped with a notice; no settings → nothing set; the application never sets a mode the learner did not choose
- [x] 3.2 `TurnService` applies settings; `PUT /workspace/nodes/{id}/agent-settings` `{ model?, effort?, fast?, mode?, confirmedUnasked? }` — a mode in the most permissive group is refused without `confirmedUnasked: true`; values validated against the offer; another account's node 404; bootstrap nodes gain `agentSettings`
- [x] 3.3 Inheritance: child and branch nodes copy `agent_settings` with `backend_agent_id`; `set_node_backend` clears them; tests
- [x] 3.4 Stream `context.usage { used, size }` events; tests

## 4. Frontend

- [x] 4.1 API client and store for the offer and node settings; tests
- [x] 4.2 Conversation header controls: model, effort, fast toggle, permission mode grouped as in design; the most permissive group asks for confirmation naming what it allows and shows a persistent marker while active; "choices appear once the agent has been reached" when unknown; stale-choice notice; tests
- [x] 4.3 Composer `/` menu lists the agent's commands under its name (with descriptions) beside `/code`, `/qa`, `/quiz`; choosing inserts `/<name>`; tests
- [x] 4.4 Context usage indicator in the conversation from `context.usage`; tests
- [x] 4.5 Playwright with the fake agent: choose a model and fast mode, send, the reply names them; choosing `bypassPermissions` asks for confirmation and marks the session; the menu lists the agent's commands and sending `/compact` reaches the agent

## 5. Verification

- [x] 5.1 Real agents (opt-in): a non-default model on each agent is reported in the turn's usage; `/compact` and `/context` (Claude) and `/status` (Codex) produce a reply over ACP; record which commands do nothing over ACP in design.md
- [x] 5.2 Full suites green; rebuild sidecar and bundle; in the built app, switch a session's model and run `/compact`
