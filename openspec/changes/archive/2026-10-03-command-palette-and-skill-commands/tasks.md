## 1. Public surfaces the registry reads

- [x] 1.1 `node-chat`: export `PRACTICE_COMMANDS` and a `useSessionOffer(nodeId)` hook (agent name, offered options by control, current choices, announced commands, `known`); unit test
- [x] 1.2 `study-launcher`: `useLauncher` store for the detailed dialog's open state; `DetailedStart` uses it; export `openDetailedStart()`; test that it opens the dialog
- [x] 1.3 `practice`: export `practiceAddCommands` (from the kinds registry: write entries and ask entries) and `openPracticeBlock(nodeId, block, {author})` through `index.ts`

## 2. The command registry

- [x] 2.1 `features/command-surface/` scaffold with `index.ts`; `Command` type
- [x] 2.2 Workspace contributor: new session, start with a topic, collapse/expand each rail, agents, memory
- [x] 2.3 Practice contributor: write entries (open blocks) and ask entries (`placeInComposer`), unavailable without an open node
- [x] 2.4 Session contributor: model, effort, fast values and asking/editing modes via `setNodeAgentSettings`; unasked modes unavailable with the reason; all unavailable with no node or no known offer
- [x] 2.5 Agent contributor: announced commands grouped under the agent's name, reserved names dropped, placed in the composer
- [x] 2.6 `useCommands()` assembling contributors; unit tests per contributor (availability, reasons, ids stable and unique, reserved names, placing never sends)

## 3. Matching

- [x] 3.1 `match(query, commands, nodes)`: subsequence match, ranking (prefix > word start > substring > subsequence), available first, archived nodes excluded, caps with counts, empty-query ordering with recent nodes; unit tests

## 4. The palette

- [x] 4.1 ⌘K / Ctrl+K capture listener mounted in `Workspace`; never types into the composer; no palette while signed out
- [x] 4.2 Overlay dialog: combobox input, listbox grouped Commands then Nodes, group label per command, reasons on unavailable entries, "+N more", no-match state
- [x] 4.3 Keyboard: arrows across categories, Enter activates (closes first, then runs), Enter inert on unavailable and no-match, Escape closes, focus restored, reopens empty
- [x] 4.4 Component tests for every palette scenario; layout test that the panes are unchanged and nothing reflows at 800×600

## 5. Verification

- [x] 5.1 E2E `command-palette.spec.ts`: open from the composer keeping the draft; run "New session"; open a node by title; place an agent command (fake agent) without sending; choose a model; unasked mode listed unavailable; Escape restores focus
- [x] 5.2 Full suites green; rebuild the bundle; in the built app, ⌘K from the composer, run a skill your agent announces, switch the model
