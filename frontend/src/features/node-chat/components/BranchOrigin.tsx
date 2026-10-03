import { messageById, nodeById } from '../../../shared/lib/fixtures'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'

type BranchOriginProps = {
  nodeId: string
}

/**
 * The top of a branched node's conversation: where it came from, and the way back.
 *
 * The origin is the node's first incoming link — bootstrap lists links in
 * insertion order — which is the same link the backend hands the agent as
 * this conversation's inherited context. A node later linked under a second
 * parent still shows, and inherits from, the one it grew from.
 */
function BranchOrigin({ nodeId }: BranchOriginProps) {
  const graph = useWorkspaceStore((s) => s.graph)
  const openSessionAt = useWorkspaceStore((s) => s.openSessionAt)

  const link = graph.links.find((candidate) => candidate.childId === nodeId)
  if (!link) return null
  const parent = nodeById(graph, link.parentId)
  if (!parent) return null
  const source = link.anchor ? messageById(graph, link.anchor.messageId) : undefined

  return (
    <p data-testid="branch-origin" className="mb-2 text-xs text-gray-500">
      <button
        type="button"
        onClick={() => void openSessionAt(parent.id, source?.threadId ?? null, source?.id ?? null)}
        className="text-left hover:text-gray-900 hover:underline"
      >
        Branched from <span className="font-medium text-gray-700">{parent.title}</span>
        {link.anchor ? <> · &ldquo;{link.anchor.excerpt}&rdquo;</> : null}
      </button>
    </p>
  )
}

export default BranchOrigin
