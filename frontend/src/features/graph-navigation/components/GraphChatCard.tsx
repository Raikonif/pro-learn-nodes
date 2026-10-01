import { memo } from 'react'

import { Handle, Position, type NodeProps } from '@xyflow/react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'

import type { GraphFlowNode } from './graph-adapter'

/**
 * Compact, keyboard-activatable node representation used by both graph
 * surfaces. The minimap variant omits the creation affordance because the
 * right rail is for orientation/navigation; the center card owns actions.
 */
function GraphChatCard({ data, isConnectable }: NodeProps<GraphFlowNode>) {
  const openNode = useWorkspaceStore((state) => state.openNode)
  const createChildNodeFrom = useWorkspaceStore((state) => state.createChildNodeFrom)
  const { node, title, mode, isCurrent, variant } = data
  const isMinimap = variant === 'minimap'

  const activateCard = () => openNode(node.id)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-current={isCurrent ? 'true' : undefined}
      data-testid="graph-node-card"
      data-node-id={node.id}
      data-current={isCurrent ? 'true' : undefined}
      data-mode={mode}
      onClick={(event) => {
        // Prevent React Flow's node click fallback from opening the node a
        // second time after this card has already handled activation.
        event.preventDefault()
        event.stopPropagation()
        activateCard()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        activateCard()
      }}
      className={`relative flex h-28 w-56 flex-col justify-between rounded-lg border bg-white p-3 text-left shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
        isCurrent ? 'border-blue-600 ring-1 ring-blue-200' : 'border-gray-200'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        aria-hidden="true"
        className="!h-1.5 !w-1.5 !border-gray-400 !bg-gray-100"
      />
      <div className="min-w-0 pr-7">
        <p className="truncate text-base font-semibold text-gray-900">{title}</p>
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          {mode} mode
        </p>
      </div>
      {!isMinimap && (
        <button
          type="button"
          aria-label={`Create child node from ${title}`}
          data-testid="create-child-node"
          className="nodrag nopan absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white text-base leading-none text-gray-700 hover:border-blue-500 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void createChildNodeFrom(node.id)
          }}
        >
          <span aria-hidden="true">+</span>
        </button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        aria-hidden="true"
        className="!h-1.5 !w-1.5 !border-gray-400 !bg-gray-100"
      />
    </div>
  )
}

export default memo(GraphChatCard)
