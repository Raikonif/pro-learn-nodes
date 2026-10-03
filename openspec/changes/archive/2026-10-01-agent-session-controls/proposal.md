## Why

Codex and Claude each run with choices a learner makes daily in their own clients — which model, how hard it thinks, how much it may do without asking, fast mode — and each carries the learner's installed skills and its own commands, such as `/compact`. Learn Nodes uses none of it: every session runs on the agent's defaults, and the agent's commands are discarded when they arrive.

Two spikes on 2026-10-03, neither sending a prompt, found everything reachable through ACP and the same in shape for both agents:

- **Session config options** (`configOptions` from `session/new`, changed with `session/set_config_option`): `model`, a `thought_level` option (Codex `reasoning_effort`, Claude `effort`), a permissions `mode`, and a fast option. Both accepted a change.
- **Available commands** (`available_commands_update`, sent unprompted after `session/new`): 49 from Codex and 66 from Claude, including the learner's installed skills (`/$archify`, `/codebase-memory`, …), `/compact`, Claude's `/autocompact` and `/context`, and Codex's `/status`.

## What Changes

- **Choose per session**, from what its agent offers: the **model**, the **reasoning effort**, **fast mode**, and the **permission mode**.
- **Permission modes are offered with what they allow stated.** A mode that lets the agent act on the learner's system without asking (Claude `auto`, `bypassPermissions`; Codex `agent-full-access`) requires explicit confirmation and stays visibly marked while active; a mode the application does not recognise is treated as that kind. Modes that ask before acting are the default, and — because Learn Nodes refuses every permission request it is asked — effectively read-only.
- **The agent's commands and skills appear in the composer's `/` menu**, labelled by agent, beside Learn Nodes' own `/code`, `/qa`, `/quiz`. Choosing one sends it to the agent as the agent expects. This is how compaction is reached: `/compact` on both, and Claude's `/autocompact` to configure its automatic compaction, which the agents perform themselves.
- **Context usage is shown** when the agent reports it, so a learner can see when a session is filling up.
- **Choices are kept on the session**, applied whenever its agent session opens, loads, or continues, and inherited by child nodes and threads. Switching a session's agent clears them.
- **Nothing is hard-coded**: options and commands are whatever each agent reports, recorded per agent.

## Capabilities

### New Capabilities

- `agent-session-controls`: choosing a session's model, effort, fast mode, and permission mode from what its agent offers; the agent's commands and skills in the composer; context usage.

### Modified Capabilities

- `node-chat-threads`: threads run with their node's agent controls.
- `node-creation-controls`: a child inherits its parent's agent controls.

## Impact

- **Backend**: the `Agent` contract gains config options and available commands (from `session/new`/`load`, `config_option_update`, `available_commands_update`) and `set_config_option`; usage updates are forwarded; `workspace_nodes.agent_settings` and `agent_registrations.offered_options` / `offered_commands` (JSON); `TurnService` applies settings before each turn; routes for an agent's offer and a node's settings.
- **Frontend**: controls in the conversation header (model, effort, fast, permission mode with confirmation and a persistent marker); the agent's commands in the `/` menu; a context-usage indicator.
- **Relation to `acp-agent-permissions-and-branching`**: that deferred change would let the learner *answer* each request. This one lets the learner choose, per session, a mode in which the agent does not ask.
- **Not in scope**: turning an agent's automatic compaction off where the agent offers no option for it; Learn Nodes' own skills (`command-palette-and-skill-commands`).
