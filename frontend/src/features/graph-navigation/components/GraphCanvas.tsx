import { useCallback, useMemo } from 'react'

import {
  Background,
  Controls,
  ReactFlow,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'

import GraphChatCard from './GraphChatCard'
import GraphProjectRegion from './GraphProjectRegion'
import {
  layoutGraph,
  workspaceGraphToReactFlow,
  type GraphCanvasVariant,
  type ReactFlowGraph,
} from './graph-adapter'

export type GraphCanvasProps = {
  variant?: GraphCanvasVariant
}

export type { GraphCanvasVariant, ReactFlowGraph }
export { layoutGraph, workspaceGraphToReactFlow }

const NODE_TYPES: NodeTypes = { chatCard: GraphChatCard, projectRegion: GraphProjectRegion }

function GraphCanvas({ variant = 'canvas' }: GraphCanvasProps) {
  const graph = useWorkspaceStore((state) => state.graph)
  const openNodeId = useWorkspaceStore((state) => state.openNodeId)
  const openNode = useWorkspaceStore((state) => state.openNode)
  const setViewport = useWorkspaceStore((state) => state.setViewport)
  const isMinimap = variant === 'minimap'

  const derived = useMemo(
    () => workspaceGraphToReactFlow(graph, { openNodeId, variant }),
    [graph, openNodeId, variant],
  )

  // Regions first: they are drawn behind the cards, and React Flow paints in
  // array order among nodes of the same z-index.
  const flowNodes = useMemo(() => [...derived.regions, ...derived.nodes], [derived])

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // A region is a backdrop, not a session.
      if (node.type === 'chatCard') openNode(node.id)
    },
    [openNode],
  )

  return (
    <div
      role="group"
      aria-label={isMinimap ? 'Session graph minimap' : 'Session graph'}
      data-testid="graph-canvas"
      data-variant={variant}
      className="h-full w-full"
    >
      <ReactFlow
        nodes={flowNodes}
        edges={derived.edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        onMoveEnd={(_event, viewport) => setViewport(viewport)}
        fitView
        fitViewOptions={{ padding: isMinimap ? 0.2 : 0.35 }}
        panOnDrag
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        className="bg-gray-50"
      >
        {!isMinimap ? (
          <>
            <Background color="#e5e7eb" gap={24} size={1} />
            <Controls showInteractive={false} aria-label="Graph viewport controls" />
          </>
        ) : null}
      </ReactFlow>
    </div>
  )
}

export default GraphCanvas
