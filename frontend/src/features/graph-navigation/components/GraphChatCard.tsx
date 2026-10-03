import { memo, useState } from 'react'

import { Handle, Position, type NodeProps } from '@xyflow/react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'

import type { GraphFlowNode, GraphNodeData } from './graph-adapter'

/**
 * "linked to N archived": a link whose other end is archived is kept, so the
 * card says it exists instead of showing no link at all, and listing the
 * archived sessions offers to restore them rather than reporting a broken link.
 * Restoring is refused while the session's project is archived; the reason the
 * backend gives is shown here, where the learner asked.
 */
function ArchivedLinks({ links }: { links: GraphNodeData['archivedLinks'] }) {
  const restoreNode = useWorkspaceStore((state) => state.restoreNode)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function restore(nodeId: string): Promise<void> {
    setError(null)
    try {
      await restoreNode(nodeId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <div className="nodrag nopan relative">
      <button
        type="button"
        data-testid="archived-links-toggle"
        aria-expanded={open}
        aria-label={`Linked to ${links.length} archived`}
        // The card activates on Enter and Space; this control is not the card.
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className="text-xs font-medium text-amber-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        linked to {links.length} archived
      </button>
      {open ? (
        <div
          data-testid="archived-links-list"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className="absolute left-0 top-full z-20 mt-1 flex w-56 flex-col gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-md"
        >
          <ul aria-label="Archived links" className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.archivedNodeId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-gray-700">{link.archivedTitle}</span>
                <button
                  type="button"
                  aria-label={`Restore ${link.archivedTitle}`}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void restore(link.archivedNodeId)
                  }}
                  className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="text-[11px] text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Compact, keyboard-activatable node representation used by both graph
 * surfaces. The minimap variant omits the creation affordance because the
 * right rail is for orientation/navigation; the center card owns actions.
 */
function GraphChatCard({ data, isConnectable }: NodeProps<GraphFlowNode>) {
  const openNode = useWorkspaceStore((state) => state.openNode)
  const createChildNodeFrom = useWorkspaceStore((state) => state.createChildNodeFrom)
  const { node, title, mode, isCurrent, variant, archivedLinks } = data
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
      {!isMinimap && archivedLinks.length > 0 ? <ArchivedLinks links={archivedLinks} /> : null}
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
