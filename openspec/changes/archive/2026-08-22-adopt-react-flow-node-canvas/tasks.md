## 1. Graph model and fixtures

- [x] 1.1 Add the React Flow and automatic tree-layout frontend dependencies, including the required library baseline styling.
- [x] 1.2 Expand the workspace fixture graph to include at least five nodes, multiple branch points, and side threads that demonstrate their exclusion from the graph.
- [x] 1.3 Add a workspace-store action that creates an unanchored whole-node child, inherits the parent's configuration, creates its main thread, and opens it.
- [x] 1.4 Add unit tests for representative fixture graph shape and whole-node child creation, including inheritance, null anchors, and open-node state.

## 2. React Flow graph surfaces

- [x] 2.1 Build a graph adapter that derives typed React Flow nodes and directed edges from `WorkspaceGraph` without introducing a second source of truth.
- [x] 2.2 Implement deterministic top-to-bottom tree positioning for fixed-size node cards and cover branch layout behavior with unit tests.
- [x] 2.3 Implement an accessible custom chat-card node that displays title and mode, opens its node on card activation, and prevents nested control events from activating the card.
- [x] 2.4 Replace the custom SVG center graph with the React Flow canvas, including pan, zoom, fit-view, and disabled manual topology editing.
- [x] 2.5 Replace the custom right-rail SVG minimap with the React Flow minimap/navigation surface while preserving the active-node indication and breadcrumb fallback.

## 3. Whole-node child creation

- [x] 3.1 Add the accessible plus control to center-canvas node cards and connect it to the whole-node child creation action.
- [x] 3.2 Verify that creating a child from a card updates the graph and left rail, opens the child's main conversation, and leaves selected-text branching behavior unchanged.

## 4. Verification

- [x] 4.1 Update component and workspace tests for card rendering, branch edges, viewport controls, minimap navigation, and absence of thread graph nodes.
- [x] 4.2 Add browser coverage for navigating the seeded graph, opening a minimap node, creating a child with the plus control, and branching from selected text.
- [x] 4.3 Run the affected frontend unit tests, type checks, and browser tests; verify the workspace remains usable at 800×600.
