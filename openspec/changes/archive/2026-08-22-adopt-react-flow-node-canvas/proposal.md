## Why

The workspace already models node-to-node branches and selection-based chats, but its custom SVG overview renders anonymous circles and offers no direct, visible control for starting a child session. Replacing that limited map with a card-based React Flow canvas will make the learning graph understandable and give learners an intentional way to branch from a whole node as well as from selected text.

## What Changes

- Add React Flow as the workspace graph renderer, using custom chat-like node cards, directed branch edges, viewport controls, and a minimap.
- Replace the existing custom SVG graph and its duplicate SVG minimap while preserving the workspace's center-map/right-rail navigation behavior.
- Add representative fixture data with several roots, branches, and threaded conversations so the canvas demonstrates real navigation and parent/child relationships.
- Add a node-card `+` control that creates a child node from the whole current node. The resulting link has no text-selection anchor; selection-based branching remains anchored and unchanged.
- Keep workspace graph state as the application source of truth; React Flow nodes and edges are a derived view, not a second graph model.
- Provide automatic initial tree positioning and keep direct edge creation and arbitrary connection editing out of scope for this change.

## Capabilities

### New Capabilities

- `react-flow-node-canvas`: Render and navigate the workspace graph as a React Flow canvas composed of chat-like node cards.
- `node-creation-controls`: Create a child node directly from a node card without requiring a text selection.

### Modified Capabilities

- `node-workspace-layout`: Use the React Flow canvas and its minimap while retaining the existing three-pane workspace navigation behavior.

## Impact

- Affects graph-navigation components, the workspace shell, fixture graph data, and workspace-store actions.
- Adds the `@xyflow/react` frontend dependency and a tree-layout dependency if required for card dimensions.
- Removes the custom SVG graph/minimap implementation; no backend API or persisted-data migration is included.
