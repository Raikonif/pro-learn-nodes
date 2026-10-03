## Context

Both measured agents describe their choices as ACP session config options. `session/new` returns `configOptions: [{ id, name, category, currentValue, options: [{ value, name }] }]`; `session/set_config_option { sessionId, configId, value }` changes one. Codex also returns the older `models` block (and accepts `session/set_model`); Claude does not. Config options are the one shape both share.

Measured 2026-10-03: Codex — `model` (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-*`, `gpt-5.5`), `reasoning_effort` (category `thought_level`), `mode`, `collaboration_mode`, `fast-mode`. Claude — `model` (`default`, `opus`, `sonnet`, `haiku`, `claude-fable-5-1`, …), `effort` (category `thought_level`), `mode`, `fast`. Both accepted a model change.

## Measured shapes (2026-10-03, one short real turn per agent)

- `usage_update`: `{ "sessionUpdate": "usage_update", "used": 17140, "size": 258400 }` (Codex); `{ …, "used": 20596, "size": 1000000, "_meta": { "_claude/model": "claude-opus-5-5" } }` (Claude). `used` and `size` are context tokens.
- `session/set_config_option` answers with the **complete** `configOptions` list as it now stands, each option carrying `name`, `description`, `type: "select"`, and options with their own `name` and `description`. No separate `config_option_update` arrived; the client refreshes from the answer and still accepts the notification if an agent sends one.
- **Claude's own default mode was `auto`** — from the learner's Claude Code settings — which is in the group that acts without asking. Codex's default was `agent`, which asks. So a session can be in a permissive mode without the application ever choosing one; the marker must reflect the *current* mode, whoever set it.

*Real agents, 2026-10-04 (`tests/test_real_agents_controls.py`):* a non-default model chosen with `session/set_config_option` is the one the turn runs on — Codex's `/status` reported `Model: gpt-6-astra[high]`, Claude's `/context` reported `Model: claude-fable-5-1`. Context usage arrived as `usage_update` on both (21.3k/258k, 20.6k/1M). `/status` (Codex) and `/context` (Claude) answer over ACP with text; Claude's `/compact` **completes with no text at all** — the conversation must render a completed empty turn as "the agent ran the command" rather than as an empty answer.

## Decisions

### Options are selected by category, not by id

The two agents name options differently (`reasoning_effort` / `effort`, `fast-mode` / `fast`) but categorise them the same: `model`, `thought_level`, `mode`, `model_config` (fast). The application looks options up by category, shows those four, and remembers each agent's own id to set it. Other categories (Codex's `collaboration_mode`) are not shown.

### Permission modes are classified, and the unknown is treated as the most permissive

Learn Nodes answers every permission request by refusing it (`acp-agent-backend`). So a mode in which the agent *asks* is, in practice, read-only for writes and execution, and only a mode in which it *does not ask* lets it act. Modes are shown in three groups, by value:

| Group | Claude | Codex | What happens here |
|---|---|---|---|
| Asks first | `default`, `plan` | `read-only`, `agent` | requests are refused and recorded; effectively read-only |
| Edits the session's folder without asking | `acceptEdits` | `workspace-write` | file edits in the node's directory proceed |
| Acts on the system without asking | `auto`, `bypassPermissions` | `agent-full-access` | anything proceeds, unasked |

The third group needs a confirmation naming what it allows, and the session shows a persistent marker while it is active. A value not in the table is put in the third group: an unknown mode is assumed to be the most permissive one, never the least. The application never chooses a mode on the learner's behalf; a session starts in the agent's default — and since that default can itself be permissive (Claude's was `auto`), the marker follows the session's *current* mode from its first turn, not only modes chosen in Learn Nodes.

### The agent's commands are relayed, not reimplemented

`available_commands_update` arrives unprompted after `session/new` (measured: 49 commands from Codex, 66 from Claude) and again when they change. The client keeps the latest list per session and records it per registration (`offered_commands`) so the menu is populated before a session opens. Each entry is `{ name, description, inputHint? }` as the agent sent it. Choosing one inserts `/<name>` in the composer; sending it is an ordinary turn whose text the agent interprets — the application adds nothing and computes nothing. That is how compaction is reached: `/compact` on both agents, and Claude's `/autocompact` to configure the automatic compaction the agent already performs. Codex prefixes skills with `$` (`/$archify`); the name is shown as announced.

Some commands are meaningful only in the agent's own terminal client and may do nothing over ACP. They are listed as the agent announces them rather than filtered by a guessed list; a task measures the ones learners are likely to use (`/compact`, `/context`, `/autocompact`, `/status`, a skill).

### Usage is forwarded as it arrives

`usage_update` notifications are currently dropped. They are forwarded as a `context.usage` stream event when they carry a used and total context size, and the conversation shows them. The payload shape is recorded in a task before the indicator is built.

### The contract reports options per session and sets them

`Agent` gains `config_options(session_id) -> list[ConfigOption]` (from the latest `session/new` / `session/load` result and `config_option_update` notifications) and `set_config_option(session_id, option_id, value)`. `ConfigOption = { id, name, category, current, values: [(value, name)] }`.

### The offer is recorded per agent registration

`agent_registrations.offered_options` (JSON) holds the model and reasoning options last reported, written whenever a session opens and by the connection test, which opens a session anyway. `GET /agents/{id}/options` reads it. Before an agent has been reached once on this device the offer is unknown, and the UI says so — the alternative, opening a throwaway session just to fill a menu, would spend a process start on every view.

### Choices live on the node and are applied before each turn

`workspace_nodes.agent_settings` (JSON, `{ model?, thought_level?, mode?, fast? }`, values only). After `TurnService` opens, loads, or continues a session it compares the session's current values with the node's and calls `set_config_option` for each difference — cheap, and correct across restarts, loads, and agents that reset options on load. A chosen value no longer offered is skipped, and the turn records a notice. Children and branches copy the parent's settings with its backend; changing a node's backend clears them.

### The selector sits in the conversation header

Beside the agent name, as in ChatGPT Desktop: selects for model, effort, and permission mode, and a fast-mode toggle, each listing the offered values with the agent's display names plus "Agent default". Changing one writes the node's settings; the next turn applies them. The permission select groups its values as in the table above.

## Interfaces

Fixed 2026-10-03 so the frontend is built in parallel. camelCase JSON; account-scoped; another account's resource is 404.

- `Option = { id, name, current: string | null, values: { value, name, description: string | null, group?: "asks" | "edits" | "unasked" }[] }` — `group` only on the mode option; `current` is the agent's own default as last reported.
- `Command = { name, description: string | null, inputHint: string | null }` — `name` without the leading `/`, as announced (Codex skills begin with `$`).
- `GET /agents/{id}/offer` → `{ known: boolean, model: Option | null, effort: Option | null, fast: Option | null, mode: Option | null, commands: Command[] }`. `known: false` until the agent has been reached on this device.
- Bootstrap nodes gain `agentSettings: { model?, effort?, fast?, mode? } | null` (the learner's choices) and `agentState: { model, effort, fast, mode, modeGroup } | null` (what the session actually ran with on its last turn; `modeGroup` is `"asks" | "edits" | "unasked"`).
- `PUT /workspace/nodes/{id}/agent-settings` `{ model?, effort?, fast?, mode?, confirmedUnasked? }` → bootstrap. A key set to `null` returns that control to the agent's default; an absent key is unchanged. A `mode` in the `unasked` group without `confirmedUnasked: true` is `422 { detail: "<reason>" }`.
- Turn stream: `session.state { model, effort, fast, mode, modeGroup }` once per turn, after choices are applied and before the agent answers; `context.usage { used, size }` whenever the agent reports it.
- A choice the agent no longer offers is recorded as a message `kind: "settings_notice"` (`role: "agent"`, `content` the reason).
- Agent commands are sent as ordinary text (`/compact`); `command` on `POST /chat/turn` stays reserved for `code`, `qa`, `quiz`.

## Risks / Trade-offs

- **Option ids and values belong to the agents** and change with their releases. Discovery records whatever they report, and a stale choice is reported rather than sent.
- **`session/set_config_option` is newer than the rest of ACP.** Both measured adapters support it; an agent that answers "method not found" keeps its defaults and the selector says choices are unavailable for it.

## Migration Plan

One revision: `workspace_nodes.agent_settings`, `workspace_nodes.agent_state`, `agent_registrations.offered_options`, and `agent_registrations.offered_commands`, all nullable JSON. Existing nodes have no choice and run on their agent's default, as today.
