## Context

The workspace graph is currently a custom SVG of circular nodes and straight lines. It derives a depth-based layout from `WorkspaceGraph`, while the Zustand workspace store owns nodes, links, threads, messages, and open-node state. Links already allow a nullable selection anchor, so a whole-node branch can be represented without changing the persisted graph shape. See proposal.md for motivation and the delta specs for behavior.

## Goals / Non-Goals

**Goals:**

- Replace the duplicate SVG canvas/minimap rendering with one card-oriented graph rendering approach.
- Preserve `WorkspaceGraph` as the source of truth and preserve existing selected-text branching semantics.
- Make a newly created whole-node child immediately useful by opening its main conversation.
- Provide deterministic, readable initial positions for the seeded branch graph.

**Non-Goals:**

- Persisting workspace state or adding backend graph APIs.
- Collaborative editing, free-form graph editing, manual edge creation, or drag-to-reparent behavior.
- Rendering side threads as independent graph entities.
- Changing the three-pane workspace or practice-tool behavior beyond replacing its graph surfaces.

## Decisions

### Use React Flow only as the graph view layer

`WorkspaceGraph.nodes` and `WorkspaceGraph.links` will be adapted into React Flow node and edge arrays at render time. Store actions will update the domain graph, and the derived canvas will refresh from that state. This prevents two competing graph stores and preserves compatibility with selection anchors and node navigation.

Alternative considered: make React Flow's controlled node/edge state authoritative. Rejected because it would duplicate threads, messages, and anchor semantics already held by the workspace store.

### Represent semantic parent-child branches as directed edges, not React Flow subflows

A graph link represents a learning-session derivation. It will become a directed edge from parent to child. React Flow grouping/`parentId` will not be used, because it means a spatial container relationship and would constrain future layout and interaction choices.

Alternative considered: place each child visually inside its parent card. Rejected because conversations are separate sessions and a deep graph would become unreadable.

### Render a custom compact chat card and an explicit plus action

Each canvas node will render a reusable card showing its title, mode cue, connection handles, click-to-open behavior, and an accessible plus button. Button events will not bubble into the card's open-node action. The plus button will call a store action dedicated to whole-node child creation; it will create a `NodeLink` with `anchor: null`, add a main thread, and select the new node.

Alternative considered: reuse the text-selection action only. Rejected because it cannot express branching from the whole conversation and is unavailable when there is no selected passage.

### Use an automatically computed top-to-bottom tree layout

The canvas will calculate initial positions from parent-child links using a tree layout library suited to fixed-size cards. Positions will be recalculated when the domain node/link graph changes, then passed to React Flow. Dragging can be disabled in the first release so the visual map remains stable and deterministic.

Alternative considered: retain the handwritten depth layout. Rejected because it does not account well for card dimensions, pan/zoom viewports, or branch growth.

### Use one graph data adapter for both center canvas and minimap

The center canvas and the right-rail minimap will consume the same derived graph data. The center surface will enable controls and card interaction; the compact right-rail surface will prioritize orientation and node activation. Existing responsive fallback to a breadcrumb remains the workspace-level responsibility.

### Enrich fixture data as a deliberate demonstration graph

Fixture data will contain a small multi-level tree with two or more branch points and side threads on separate nodes. It will be intentionally readable at the initial fit view and will exercise unanchored and selection-anchored links.

## Risks / Trade-offs

- [Card labels or controls overlap at small sizes] → Use compact, fixed card dimensions; rely on zoom and fit-view rather than shrinking the cards beyond readability.
- [A third-party canvas baseline stylesheet conflicts with Tailwind] → Import only the library's required baseline stylesheet, scope card appearance to Tailwind utilities, and verify the 800×600 workspace requirement.
- [Re-layout causes disorienting movement after child creation] → Use deterministic ordering and fit/select the new child instead of animating the entire graph unpredictably.
- [Nested button clicks open a node accidentally] → Stop propagation from node-card controls and cover it with component tests.
- [Fixture-only state hides persistence concerns] → Keep persistence explicitly outside scope and avoid designing the canvas API around fixture assumptions.

## Migration Plan

1. Add the canvas and layout dependencies, graph adapter, custom card, and fixture data behind the existing workspace state.
2. Replace the center SVG graph and right-rail SVG minimap with the new derived graph surfaces while preserving node open/close behavior.
3. Add whole-node child creation and tests alongside the existing selected-text path.
4. Verify unit and browser flows at the current minimum workspace size.
5. Roll back by restoring the previous SVG graph components and removing the new dependency imports; the domain graph format remains compatible because unanchored links are already supported.
