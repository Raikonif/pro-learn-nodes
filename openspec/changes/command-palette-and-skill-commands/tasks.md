Tasks follow `tdd-workflow-conventions`: the failing test precedes the code that satisfies it, and each group ends green. Backend work observes `api → service → repository → models`; frontend work observes Scream Architecture, with `features/command-surface/` exporting only through its `index.ts`.

## 1. Catalogue read with rejections reported

- [ ] 1.1 Write failing service tests for reading the skills directory: a valid folder is returned as loaded; a folder with a missing or malformed definition is returned as rejected with a reason naming the folder; one rejected folder does not suppress a valid one; an absent skills directory yields an empty catalogue rather than an error
- [ ] 1.2 Write a failing test that two folders declaring the same skill name yield one loaded skill and one rejection naming the collision
- [ ] 1.3 Implement the catalogue read in `service/` returning loaded skills and rejections as one result, keeping loading non-fatal
- [ ] 1.4 Write a failing route test for the catalogue endpoint: it returns loaded skills with name and description, returns rejections with folder and reason, and refuses without an active account
- [ ] 1.5 Add the catalogue route in `api/routes/` delegating to the service, with request/response schemas in `api/schemas/`
- [ ] 1.6 Write a failing test that re-reading the catalogue after a folder is added or removed reflects the change without process restart, then make it pass

## 2. Skill invocation on the backend

- [ ] 2.1 Write failing service tests for the one-shot run: the request carries the node's stored skills plus the invoked one; the node's stored active skill set is unchanged afterwards; a skill already active is carried exactly once
- [ ] 2.2 Write a failing test that a run whose request fails still leaves the node's stored active skill set unchanged
- [ ] 2.3 Implement the one-shot run in `service/` by composing a request-scoped skill list, never by writing and unwriting the node
- [ ] 2.4 Write failing service tests for the activation toggle: activating adds the skill to the node, deactivating removes it, both persist across a reload, and neither sends a request or adds a turn
- [ ] 2.5 Implement the activation toggle in `service/`, writing through the repository layer
- [ ] 2.6 Write a failing test that invoking a skill whose folder is no longer readable is refused with a stated reason, leaves the node's skill set unchanged, and adds no turn
- [ ] 2.7 Write a failing test that a node holding an active skill that is no longer readable still answers a message, without that skill, and reports the load failure
- [ ] 2.8 Implement both refusal paths
- [ ] 2.9 Write failing route tests for the run and toggle endpoints: each refuses without an active account, refuses a node the active account does not own, and refuses an unknown node identically
- [ ] 2.10 Add the run and toggle routes in `api/routes/`, taking the target thread for the run and the target node for the toggle
- [ ] 2.11 Write a failing test that the run route refuses while a response is streaming into the target thread, and that the toggle route succeeds in the same condition

## 3. The command registry

- [ ] 3.1 Write failing tests for registry derivation: a loaded skill yields exactly two commands, one run and one toggle, each named for the skill and carrying its description; removing the skill from the catalogue removes both
- [ ] 3.2 Write a failing test that command identifiers are stable across repeated derivations from the same catalogue and unique within the registry
- [ ] 3.3 Write a failing test that the toggle command is presented as deactivating when the skill is active on the open node and as activating when it is not
- [ ] 3.4 Write failing tests for availability: skill commands are unavailable with a stated reason when no node is open; navigation commands are available with no node open; a rejected skill folder appears as a permanently unavailable entry naming folder and reason
- [ ] 3.5 Implement the registry as a derivation over catalogue plus context in `features/command-surface/`, exported through its `index.ts`
- [ ] 3.6 Add the non-skill commands the registry owns in this change, including reloading the skills catalogue, which requires no open node
- [ ] 3.7 Write a failing test that the registry exposes no way for a consumer to add, remove, or hide a command, then assert it against the feature's public surface

## 4. The command palette

- [ ] 4.1 Write failing tests for opening: the shortcut opens the palette from the graph and from a focused composer, with an empty query and focus in the query field, and an unsent composer draft is untouched
- [ ] 4.2 Write failing tests for dismissal: Escape closes, discards the query, runs nothing, and returns focus to the previously focused element; reopening starts empty
- [ ] 4.3 Implement the palette overlay and its key binding in `features/command-surface/`
- [ ] 4.4 Write failing tests for matching: one query returns commands, nodes, and projects, each labelled with its category; a query whose characters appear in order but not adjacently still matches a command
- [ ] 4.5 Write failing tests for ordering: categories render Commands, then Nodes, then Projects; unavailable commands sort after available ones within Commands; a truncated category states that further matches were not listed
- [ ] 4.6 Write a failing test for the empty query: available commands are listed first, then recently opened nodes in recency order, then projects
- [ ] 4.7 Implement search, grouping, ranking, and the per-category cap
- [ ] 4.8 Write failing tests for keyboard operation: arrows cross category boundaries, the first available result is highlighted whenever the result set changes, Enter activates the highlight, and the palette closes before the effect is applied
- [ ] 4.9 Write failing tests for the no-match state: the palette says nothing matched, and Enter creates nothing and runs nothing
- [ ] 4.10 Implement keyboard traversal, activation, and the empty state
- [ ] 4.11 Write failing tests for account gating: the shortcut is inert on the sign-in surface, an open palette closes on sign-out, and no other account's nodes or projects appear in results
- [ ] 4.12 Implement account gating by mounting the palette inside the account-gated workspace in `app/App.tsx`

## 5. The composer command menu

- [ ] 5.1 Write failing tests for opening: `/` at position zero of an empty composer opens the menu; a `/` anywhere else does not; the menu is available in a spawned thread's composer as well as a main thread's
- [ ] 5.2 Write failing tests for filtering: the typed text filters by command-name prefix; the menu closes at the first character that matches no command name; whitespace closes the menu
- [ ] 5.3 Write failing tests that `/usr/bin/env` and `/quiz me on this` leave the composer holding the literal text with the menu closed
- [ ] 5.4 Implement the menu, its trigger condition, and prefix filtering in `features/command-surface/`
- [ ] 5.5 Write failing tests for key handling: with the menu open the first available entry is highlighted, arrows move it, Enter invokes the highlighted command and adds no message, and Escape closes the menu while preserving every typed character
- [ ] 5.6 Write a failing test that Enter after Escape sends the literal slash-leading message and runs no command
- [ ] 5.7 Write a failing test that invoking a command clears the token from the composer and adds no message consisting of that token
- [ ] 5.8 Write a failing test that unavailable entries are listed with their reason, are never the highlighted entry, and are not invoked by Enter
- [ ] 5.9 Implement key handling, invocation, and the unavailable-entry treatment
- [ ] 5.10 Write a failing test that the composer menu and the palette offer the same command names and availability for the same workspace state, and that the menu lists no node and no project
- [ ] 5.11 Mount the menu in the `node-chat` composer through the `features/command-surface/` public surface only

## 6. Invocation behavior in the workspace

- [ ] 6.1 Write failing tests that a one-shot run adds a turn attributed to the invoking skill, and that the attribution is still present after the node is closed and reopened
- [ ] 6.2 Write a failing test that the turn following a one-shot run is answered with the node's stored active skills only
- [ ] 6.3 Write failing tests that activating a skill applies to the next message with no restart and no workspace reload, persists across closing and reopening the node, and adds no turn
- [ ] 6.4 Write a failing test that deactivating a skill leaves earlier turns produced under it unchanged
- [ ] 6.5 Write failing tests for thread scoping: activation from a spawned thread's composer changes the owning node and reaches every thread; a run invoked from the palette with a spawned thread open lands in that thread, not the main thread
- [ ] 6.6 Write failing tests for the no-node case: invoking a skill command from the palette while the graph is showing creates no node, sends no request, and reports that an open node is required; opening a node makes the same command run
- [ ] 6.7 Write failing tests for the streaming case: a run is unavailable and reports the thread as busy while a response streams, while a toggle succeeds and leaves the in-flight response untouched
- [ ] 6.8 Wire the registry's skill commands to the run and toggle routes so all of the above pass

## 7. Workspace layout integration

- [ ] 7.1 Write failing tests that opening the palette adds no pane and does not resize or reflow the left rail, center region, or right rail, and that dismissing it restores the prior state exactly
- [ ] 7.2 Write a failing test that the palette's query field and results remain legible at 800×600 with the three panes unreflowed
- [ ] 7.3 Write failing tests that the left-rail node search still returns nodes after the palette exists, and that a left-rail query matching a command name returns only nodes
- [ ] 7.4 Make the layout tests pass, styling the overlay with Tailwind utilities only

## 8. End-to-end

- [ ] 8.1 Add a Playwright fixture pointing the backend at a temporary skills directory holding one valid skill and one deliberately malformed folder
- [ ] 8.2 Add an E2E test: sign in, open a node, press the palette shortcut, find the valid skill listed and the malformed folder listed as unavailable with a reason, run the skill once, and assert the node's active skill set is unchanged
- [ ] 8.3 Add an E2E test: type `/` in the composer, invoke the skill's activation command, send a message, and assert the response reflects the skill without the application restarting
- [ ] 8.4 Add an E2E test: type `/usr/bin/env` in the composer, send it, and assert the message appears verbatim with its leading slash and that no command ran

## 9. Documentation

- [ ] 9.1 Record in `CLAUDE.md` that the command surface is derived from the loaded skill catalogue and that no command is registered by hand
- [ ] 9.2 Update `openspec/tech-stack.md` so the Skills System section states that invalid skills are skipped without failing a session and reported with a reason, replacing "silently skipped"
- [ ] 9.3 Note in the roadmap's Phase 5 entry that the loader returns rejections alongside loaded skills, which Phase 5a renders
