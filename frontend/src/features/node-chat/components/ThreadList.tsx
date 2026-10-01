import { resolveAnchor } from '../../../shared/lib/anchor-resolver'
import { messageById, messagesForThread, threadsForNode } from '../../../shared/lib/fixtures'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { isMainThread } from '../../../shared/lib/workspace-types'

/**
 * Every thread on the open node, in one place.
 *
 * Threads nest arbitrarily deep, and a stub is only visible from inside the
 * thread that spawned it — so without this surface a thread three levels down
 * is reachable only by retracing the path that made it. The list is flat on
 * purpose: `nodeId` already says which node owns a thread regardless of depth,
 * and a tree here would repeat information the stubs already carry.
 *
 * Deliberately offers no mode / skills / MCP control: configuration lives on
 * the node, and threads inherit it (node-chat-threads spec).
 */
function ThreadList() {
  const graph = useWorkspaceStore((s) => s.graph)
  const openNodeId = useWorkspaceStore((s) => s.openNodeId)
  const openThreadId = useWorkspaceStore((s) => s.openThreadId)
  const openThread = useWorkspaceStore((s) => s.openThread)

  if (!openNodeId) return null
  const threads = threadsForNode(graph, openNodeId)

  return (
    <nav aria-label="Threads on this node" className="flex flex-col gap-1">
      <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Threads
      </h3>
      <ul className="flex flex-col gap-1">
        {threads.map((thread) => {
          const count = messagesForThread(graph, thread.id).length
          const stale = thread.anchor
            ? resolveAnchor(thread.anchor, messageById(graph, thread.anchor.messageId))
                .status === 'stale'
            : false
          const isOpen = openThreadId === thread.id
          return (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => openThread(thread.id)}
                aria-current={isOpen ? 'true' : undefined}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${
                  isOpen ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="truncate">
                  {isMainThread(thread) ? 'main' : thread.name}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-gray-500">{count}</span>
                {stale ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                    stale
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default ThreadList
