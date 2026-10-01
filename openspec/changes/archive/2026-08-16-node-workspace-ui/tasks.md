## 0. Preconditions

- [x] 0.1 Confirm `cd frontend && pnpm test`, `pnpm run typecheck`, and `cd backend && uv run pytest` are all green before starting
- [x] 0.2 Confirm `pnpm run backend:dev` serves `/health` — the workspace chrome indicator depends on it

## 1. Domain types and fixture data

The Phase 2 data model does not exist yet, so the workspace renders against fixtures. Types written here are the contract Phase 2 must satisfy (see `design.md` Dependencies).

- [x] 1.1 Add `frontend/src/shared/lib/workspace-types.ts` defining `Node`, `ChatThread`, `ChatMessage`, and `SelectionAnchor` (`messageId`, `start`, `end`, `excerpt`), with Zod schemas per the existing `api-client` convention
- [x] 1.2 Add `frontend/src/shared/lib/workspace-types.test.ts` asserting the Zod schemas accept a valid graph and reject an anchor missing `excerpt`
- [x] 1.3 Add `frontend/src/shared/lib/fixtures.ts` with a fixture graph: one root node, two children, one grandchild shared by both children, each node carrying a `main` thread with several messages
- [x] 1.4 Extend the fixture with one spawned thread anchored inside a `main` thread message, and one thread nested inside that thread
- [x] 1.5 Add one fixture anchor whose `excerpt` no longer matches its source message, to exercise the stale path

## 2. Workspace state

- [x] 2.1 Add `frontend/src/shared/lib/workspace-store.ts` (Zustand) holding `openNodeId`, `openThreadId`, and the recents list
- [x] 2.2 Add `frontend/src/shared/lib/workspace-store.test.ts` covering: opening a node selects its `main` thread; closing a node clears both; opening a thread leaves `openNodeId` unchanged
- [x] 2.3 Add an anchor resolver in `shared/lib/` that locates an anchor's `excerpt` at its offsets in the source message and reports resolved-or-stale
- [x] 2.4 Add resolver tests: text unchanged resolves; text rewritten at those offsets reports stale; a stale anchor still returns its stored `excerpt`

## 3. Three-pane shell

- [x] 3.1 Add `frontend/src/app/Workspace.tsx` rendering three panes — left rail, center region, right rail — with Tailwind utilities only
- [x] 3.2 Add `frontend/src/app/Workspace.test.tsx` asserting all three panes render and the layout holds at 800×600
- [x] 3.3 Move the `/health` status indicator into the workspace chrome, preserving the green/red dot and the "Backend online"/"Backend offline" labels, with no polling and no retries
- [x] 3.4 Add a test covering both status indicator branches against a mocked `/health`
- [x] 3.5 Point `frontend/src/app/App.tsx` at `Workspace` as the root view

## 4. Left rail — node index

- [x] 4.1 Add `features/graph-navigation/components/RecentsRail.tsx` listing nodes by recency, most recent first, and exposing a search input
- [x] 4.2 Add `RecentsRail.test.tsx` asserting: nodes list in recency order; activating one sets `openNodeId`; a search term filters to matching nodes
- [x] 4.3 Add a test asserting spawned threads never appear in the rail, using the nested-thread fixture
- [x] 4.4 Export `RecentsRail` from `features/graph-navigation/index.ts`

## 5. Center graph and node entry

- [x] 5.1 Add `features/graph-navigation/components/GraphCanvas.tsx` rendering the fixture graph as SVG with a deterministic layout, including the shared grandchild's two incoming edges. `react-force-graph` is deferred to Phase 3, where the roadmap already places the spatial canvas (see design.md Decision 7)
- [x] 5.2 Add `GraphCanvas.test.tsx` asserting every fixture node renders and activating one sets `openNodeId`
- [x] 5.3 Wire `Workspace` to render `GraphCanvas` in the center when `openNodeId` is unset, and to render no minimap in that state
- [x] 5.4 Add a `Workspace` test asserting the idle state shows the graph in the center and no minimap
- [x] 5.5 Export `GraphCanvas` from the feature's `index.ts`

## 6. Right rail — minimap over tools

- [x] 6.1 Add `features/graph-navigation/components/GraphMinimap.tsx` reusing the SVG graph at fixed height with the open node visually distinguished
- [x] 6.2 Add `GraphMinimap.test.tsx` asserting the open node is distinguished and activating a different node changes `openNodeId` without clearing it first
- [x] 6.3 Add `features/graph-navigation/components/GraphBreadcrumb.tsx` rendering the path to the open node, expanding to the full minimap on hover
- [x] 6.4 Add a test asserting the minimap collapses to the breadcrumb below the height threshold and expands on hover
- [x] 6.5 Add `features/practice/components/PracticeRail.tsx` with Q&A / Code / Quiz tab containers — empty shells, contents are Phase 12
- [x] 6.6 Add a test asserting selecting a practice tab does not unmount or hide the minimap
- [x] 6.7 Export `GraphMinimap` and `GraphBreadcrumb` from `graph-navigation/index.ts`, `PracticeRail` from `practice/index.ts`

## 7. Center↔minimap transition

- [x] 7.1 Wire `Workspace` so opening a node moves the conversation into the center and the graph into the right rail as a minimap
- [x] 7.2 Wire closing a node to restore the graph to the center and remove the minimap
- [x] 7.3 Add `Workspace` tests covering both directions of the transition

## 8. Node conversation

- [x] 8.1 Add `features/node-chat/components/NodeConversation.tsx` rendering a thread's messages with the node title and mode in a header
- [x] 8.2 Add `NodeConversation.test.tsx` asserting a node opens on its `main` thread and the `main` thread offers no delete action
- [x] 8.3 Export `NodeConversation` from `features/node-chat/index.ts`

## 9. Selection affordance

- [x] 9.1 Add `features/node-chat/components/SelectionAffordance.tsx` raising exactly two actions on a non-empty text selection inside a message
- [x] 9.2 Add `SelectionAffordance.test.tsx` covering: selection inside a message raises the affordance with exactly two actions; selection outside a message raises nothing; clearing the selection dismisses it without creating anything
- [x] 9.3 Assert the affordance appears for both learner and agent messages
- [x] 9.4 Add an anchor builder that captures `messageId`, `start`, `end`, and a stored copy of the selected text, with a test asserting `excerpt` is stored rather than derived on read

## 10. Generate-node action

- [x] 10.1 Wire "generate a node" to create a node linked to the source node, carrying the anchor
- [x] 10.2 Add a test asserting the new node appears in the graph and the left rail
- [x] 10.3 Add a test asserting the new node inherits the source node's mode, active skills, and MCP servers when no override is given
- [x] 10.4 Add a test asserting generating from inside a nested thread links the new node to the node that owns the thread

## 11. New-chat action and threads

- [x] 11.1 Wire "new chat" to create a thread on the current node carrying the anchor, creating no node
- [x] 11.2 Add a test asserting the graph, minimap, and left rail are unchanged after creating a thread
- [x] 11.3 Add `features/node-chat/components/ThreadStub.tsx` rendering a collapsed stub at its anchor showing thread name and message count
- [x] 11.4 Add `ThreadStub.test.tsx` asserting the stub renders at the anchor, the count tracks the thread's messages, and the stub stays visible while the thread is expanded
- [x] 11.5 Wire activating a stub to render that thread in the center in place of its source thread
- [x] 11.6 Add a back-link header naming the source text, returning to the source thread scrolled to the anchor, with tests for both
- [x] 11.7 Add a test asserting selecting text inside a spawned thread offers the same two actions, and that a thread spawned from a thread belongs to the same node
- [x] 11.8 Add `features/node-chat/components/ThreadList.tsx` enumerating every thread on the open node, with a test asserting nested threads are all reachable without locating their stubs
- [x] 11.9 Add a test asserting no per-thread mode, skills, or MCP control is rendered, and that changing the node's configuration applies to every thread on it

## 12. Stale anchors

- [x] 12.1 Render a branch whose anchor fails to resolve using its stored `excerpt`, marked stale
- [x] 12.2 Add tests asserting a stale branch stays reachable and is neither deleted nor hidden — one for a rewritten source message, one for a compacted turn

## 13. Retire the placeholder

- [x] 13.1 Delete `frontend/src/app/Placeholder.tsx` and `frontend/src/app/Placeholder.test.tsx`
- [x] 13.2 Update `frontend/e2e/app.spec.ts` (the placeholder e2e spec is named `app.spec.ts`, not `placeholder.spec.ts`) so its assertions target the workspace
- [x] 13.3 Confirm no import of `Placeholder` remains and `pnpm run typecheck` is clean

## 14. End-to-end coverage

- [x] 14.1 Add `frontend/e2e/workspace.spec.ts` asserting the window opens on the workspace with all three panes visible
- [x] 14.2 Extend it: enter a node from the center graph, assert the conversation takes the center and the minimap appears in the right rail
- [x] 14.3 Extend it: select text, choose "generate a node", assert the new node appears in the graph
- [x] 14.4 Extend it: select text, choose "new chat", assert a stub appears and the graph is unchanged
- [x] 14.5 Run `cd frontend && pnpm exec playwright test` with the backend running and confirm the spec passes

## 15. Verify

- [x] 15.1 `cd frontend && pnpm test` green
- [x] 15.2 `cd frontend && pnpm run typecheck` clean
- [x] 15.3 `cd backend && uv run pytest` still green (no backend change expected)
- [x] 15.4 `openspec validate node-workspace-ui --strict` passes
- [x] 15.5 Run `pnpm tauri dev` and confirm the workspace renders in the native window. Verified during the `dev-port-allocation` window runs: the window opened and the backend logged `GET /health` from the webview. That request originates in `BackendStatus`, which renders inside the workspace chrome, so the workspace mounted
- [x] 15.6 Annotate `openspec/roadmap.md` to record that Phases 3, 7, and 8 now inherit their UI frame from this change

## 16. Out of scope — do not do

- [x] 16.1 Do NOT implement `ChatThread`, `ChatMessage.thread_id`, `SelectionAnchor`, or any migration — that is the Phase 2 data model change
- [x] 16.2 Do NOT resolve `Link` vs `Node.parent_id` as the graph's source of truth — it is logged in `design.md` and blocks Phase 2, not this change
- [x] 16.3 Do NOT define what context a spawned thread sends to a provider — logged as open, and there is no provider layer until Phase 4
- [x] 16.4 Do NOT build practice tool contents, correction UI, compaction drill-down, memory panel, or the study launcher
- [x] 16.5 Do NOT add keyboard shortcuts or dark mode — Phase 14
- [x] 16.6 Do NOT restructure the scream architecture feature directories — new code lands in the existing ones
