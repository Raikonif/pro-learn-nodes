import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { graphlib, layout } from '@dagrejs/dagre'

import type { NodeLink, WorkspaceGraph, WorkspaceNode } from '../../../shared/lib/workspace-types'

/** The card dimensions are fixed so the initial layout remains deterministic. */
export const GRAPH_NODE_WIDTH = 224
export const GRAPH_NODE_HEIGHT = 112
export const GRAPH_NODE_SEPARATION = 64
export const GRAPH_RANK_SEPARATION = 88

export type GraphCanvasVariant = 'canvas' | 'minimap'

export type GraphNodeData = {
  /** The domain object is the source of truth for the card. */
  node: WorkspaceNode
  nodeId: string
  title: string
  mode: WorkspaceNode['mode']
  isCurrent: boolean
  variant: GraphCanvasVariant
}

export type GraphFlowNode = Node<GraphNodeData, 'chatCard'>

export type GraphEdgeData = {
  /** Keep the complete domain link available to derived graph consumers. */
  link: NodeLink
  anchor: NodeLink['anchor']
}

export type GraphFlowEdge = Edge<GraphEdgeData>

export type PositionedGraphNode = {
  node: WorkspaceNode
  x: number
  y: number
  width: number
  height: number
}

export type GraphLayout = {
  width: number
  height: number
  nodes: PositionedGraphNode[]
}

export type ReactFlowGraph = {
  nodes: GraphFlowNode[]
  edges: GraphFlowEdge[]
  layout: GraphLayout
}

/**
 * Lay out the domain graph as a stable top-to-bottom DAG.
 *
 * Dagre returns node centers; React Flow positions nodes from their top-left
 * corner, so the conversion is kept here with the fixed card dimensions.
 * Insertion order follows the domain arrays, making repeated layouts stable
 * for the same WorkspaceGraph.
 */
export function layoutGraph(graph: WorkspaceGraph): GraphLayout {
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const dagreGraph = new graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({
    rankdir: 'TB',
    nodesep: GRAPH_NODE_SEPARATION,
    ranksep: GRAPH_RANK_SEPARATION,
    marginx: GRAPH_NODE_SEPARATION,
    marginy: GRAPH_RANK_SEPARATION,
  })

  for (const node of graph.nodes) {
    dagreGraph.setNode(node.id, {
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
    })
  }

  for (const link of graph.links) {
    // A partially-created link should not make the view fail. The store's
    // validated graph normally makes this filter a no-op.
    if (nodeIds.has(link.parentId) && nodeIds.has(link.childId)) {
      // Dagre's default graph is not a multigraph, so the edge identifier is
      // intentionally omitted here. React Flow retains the domain link id on
      // the derived edge below.
      dagreGraph.setEdge(link.parentId, link.childId, {})
    }
  }

  if (graph.nodes.length > 0) layout(dagreGraph)

  const positions = graph.nodes.map((node) => {
    const positioned = dagreGraph.node(node.id)
    const centerX = positioned?.x ?? GRAPH_NODE_WIDTH / 2
    const centerY = positioned?.y ?? GRAPH_NODE_HEIGHT / 2
    return {
      node,
      x: centerX - GRAPH_NODE_WIDTH / 2,
      y: centerY - GRAPH_NODE_HEIGHT / 2,
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
    }
  })

  const dagreDimensions = dagreGraph.graph()
  return {
    width: Math.max(dagreDimensions.width ?? 0, GRAPH_NODE_WIDTH),
    height: Math.max(dagreDimensions.height ?? 0, GRAPH_NODE_HEIGHT),
    nodes: positions,
  }
}

export type ReactFlowGraphOptions = {
  openNodeId?: string | null
  variant?: GraphCanvasVariant
}

/**
 * Derive React Flow's view model from the workspace graph.
 *
 * No React Flow state is stored here: nodes and edges are regenerated from
 * WorkspaceGraph whenever the store graph changes. Thread data is intentionally
 * ignored, because a thread is a conversation inside a node rather than a
 * graph entity.
 */
export function workspaceGraphToReactFlow(
  graph: WorkspaceGraph,
  { openNodeId = null, variant = 'canvas' }: ReactFlowGraphOptions = {},
): ReactFlowGraph {
  const layout = layoutGraph(graph)
  const positionedById = new Map(layout.nodes.map((positioned) => [positioned.node.id, positioned]))
  const validNodeIds = new Set(graph.nodes.map((node) => node.id))

  const nodes: GraphFlowNode[] = graph.nodes.flatMap((node) => {
    const positioned = positionedById.get(node.id)
    if (!positioned) return []
    return [
      {
        id: node.id,
        type: 'chatCard',
        position: { x: positioned.x, y: positioned.y },
        // React Flow can render the fixed-size card immediately (including in
        // jsdom, where ResizeObserver has no real layout measurements).
        initialWidth: GRAPH_NODE_WIDTH,
        initialHeight: GRAPH_NODE_HEIGHT,
        data: {
          node,
          nodeId: node.id,
          title: node.title,
          mode: node.mode,
          isCurrent: variant === 'minimap' && node.id === openNodeId,
          variant,
        },
        draggable: false,
        selectable: false,
      },
    ]
  })

  const edges: GraphFlowEdge[] = graph.links.flatMap((link) => {
    if (!validNodeIds.has(link.parentId) || !validNodeIds.has(link.childId)) return []
    return [
      {
        id: link.id,
        source: link.parentId,
        target: link.childId,
        type: 'smoothstep',
        data: { link, anchor: link.anchor },
        markerEnd: { type: MarkerType.ArrowClosed },
        selectable: false,
        reconnectable: false,
      },
    ]
  })

  return { nodes, edges, layout }
}

// A descriptive alias keeps call sites readable while preserving the short
// name used by graph-navigation tests and older consumers.
export const toReactFlowGraph = workspaceGraphToReactFlow
