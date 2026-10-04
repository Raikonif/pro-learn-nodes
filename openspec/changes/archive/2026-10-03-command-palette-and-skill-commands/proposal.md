## Why

Learn Nodes now does many things, and each lives behind its own control: starting a session, the rails, agent settings, memory, the workbench's add menu, the session's model, effort and permission mode, and the commands and skills each agent announces. Nothing lets a learner reach them from one place by name, and the agent's skills are discoverable only by typing `/` in the composer. A keyboard-first palette over one command registry gives every action a home without adding a pane or a button.

The change was first written (August) around Learn Nodes' own skills folder (`~/.learn-nodes/skills/`, roadmap Phase 5). Since then nodes run on ACP agents, and the learner's skills arrive from the agent itself (`available_commands_update`): Codex and Claude announce them, and `agent-session-controls` relays them rather than reimplementing them. This revision follows that: skills in the registry are the agent's, and the application's own skills system is out of scope.

## What Changes

- Add a **command registry**: one runtime list of commands, assembled from contributors — the workspace (new session, start with a topic, the rails, agents, memory), practice (the workbench's add entries), the open session's controls (model, effort, fast mode, permission mode), and the commands and skills the open node's agent last announced. A newly announced agent skill appears with no code change.
- Add the **⌘K palette** (Ctrl+K off macOS): an overlay that searches commands and nodes in one query, is fully keyboard-operable, and closes on Escape with no side effect. Projects join its results when `node-projects-and-archive` lands.
- Commands that need an open node, or an agent the session has reached, are **listed as unavailable with the reason** rather than hidden.
- A permission mode that acts without asking is **not set from the palette**: it is listed with the reason and the session controls remain the one place it is confirmed.
- Anything that can be sent from the composer — `/code`, `/qa`, `/quiz`, and the agent's commands and skills — is reachable from the palette, which **places it in the composer without sending**. The composer's `/` menu keeps its current behaviour.
- The palette exists only while an account is active and lists only that account's nodes.

## Capabilities

### New Capabilities

- `command-registry`: the single runtime list of commands — its contributors, how commands are named and grouped, when one is unavailable and why, and how the agent's announced commands enter it.
- `command-palette`: the ⌘K overlay — opening and dismissal, the query over commands and nodes, ordering, keyboard operation, empty and no-match states, and account scoping.

### Modified Capabilities

- `node-workspace-layout`: the palette is an overlay above the three panes, never a fourth pane, and the left rail's search stays as it is.

## Impact

- **Frontend only.** New `features/command-surface/` (registry, matching, palette) exported through its `index.ts`, mounted by `app/Workspace.tsx`. Contributors are read from other features' public surfaces: `practice` (add entries), `node-chat` (`PRACTICE_COMMANDS`, `placeInComposer`, session commands), `study-launcher` (opening the detailed start from outside its button), `settings` and `memory` (open panels), `shared/lib/pane-layout` (rails).
- **No backend change.** Session choices go through the existing `setNodeAgentSettings`; agent commands come from the offer already loaded for the session.
- **Not in scope**: Learn Nodes' own skills folder and per-node skill activation (roadmap Phase 5), ⌘N/⌘F/⌘B, MCP tools as commands, command history, and searching message content (the left rail does that).
