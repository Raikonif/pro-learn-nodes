// Public surface for the graph-navigation feature.
// Import this feature only via this file; internal paths are private.
export { default as RecentsRail } from './components/RecentsRail'
export { default as GraphCanvas } from './components/GraphCanvas'
export { default as GraphChatCard } from './components/GraphChatCard'
export { default as GraphMinimap } from './components/GraphMinimap'
export { default as GraphBreadcrumb } from './components/GraphBreadcrumb'
export { default as GraphRail } from './components/GraphRail'
export type { GraphCanvasProps, GraphCanvasVariant } from './components/GraphCanvas'
export {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_SEPARATION,
  GRAPH_NODE_WIDTH,
  GRAPH_RANK_SEPARATION,
  layoutGraph,
  toReactFlowGraph,
  workspaceGraphToReactFlow,
} from './components/graph-adapter'
export type {
  GraphCanvasVariant as GraphAdapterCanvasVariant,
  GraphEdgeData,
  GraphFlowEdge,
  GraphFlowNode,
  GraphLayout,
  GraphNodeData,
  PositionedGraphNode,
  ReactFlowGraph,
  ReactFlowGraphOptions,
} from './components/graph-adapter'
export type { GraphRailProps } from './components/GraphRail'
export { MINIMAP_MIN_HEIGHT, DEFAULT_AVAILABLE_HEIGHT } from './components/GraphRail'
