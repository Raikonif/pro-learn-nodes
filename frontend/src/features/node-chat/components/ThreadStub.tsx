import { messageById, messagesForThread } from '../../../shared/lib/fixtures'
import { resolveAnchor } from '../../../shared/lib/anchor-resolver'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { ChatThread } from '../../../shared/lib/workspace-types'

/** Stable hook for tests and for the back-link's scroll target. */
export function stubElementId(threadId: string): string {
  return `thread-stub-${threadId}`
}

type ThreadStubProps = {
  thread: ChatThread
}

/**
 * The collapsed representation of a spawned thread, rendered in the thread it
 * was spawned from.
 *
 * It stays rendered while its thread is expanded: the stub is the anchor's
 * only visible trace, and removing it while the learner is inside the thread
 * would delete the landmark the back-link scrolls to.
 */
function ThreadStub({ thread }: ThreadStubProps) {
  const graph = useWorkspaceStore((s) => s.graph)
  const openThreadId = useWorkspaceStore((s) => s.openThreadId)
  const openThread = useWorkspaceStore((s) => s.openThread)

  // Counted from the graph on every render rather than cached, so the stub
  // tracks the thread's activity instead of the count it was born with.
  const count = messagesForThread(graph, thread.id).length
  const anchor = thread.anchor
  // A stub only exists for anchored threads; a main thread has no stub.
  if (!anchor) return null

  const resolution = resolveAnchor(anchor, messageById(graph, anchor.messageId))
  const stale = resolution.status === 'stale'
  const isOpen = openThreadId === thread.id
  const messageLabel = `${count} ${count === 1 ? 'message' : 'messages'}`
  const label = stale
    ? `Open thread "${thread.name}" (${messageLabel}) — stale anchor, showing the text it was branched from`
    : `Open thread "${thread.name}" (${messageLabel})`

  return (
    <button
      type="button"
      id={stubElementId(thread.id)}
      data-thread-stub={thread.id}
      aria-label={label}
      title={stale ? `Stale anchor — stored text: "${anchor.excerpt}"` : resolution.text}
      aria-current={isOpen ? 'true' : undefined}
      onClick={() => openThread(thread.id)}
      className={`mt-1 inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs transition-colors ${
        isOpen
          ? 'border-indigo-400 bg-indigo-50 text-indigo-900'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <span aria-hidden="true" className="text-gray-400">
        ↳
      </span>
      <span className="truncate font-medium">{thread.name}</span>
      <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
        {messageLabel}
      </span>
      {stale ? (
        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
          stale
        </span>
      ) : null}
      {/*
        Rendering the stored excerpt when the anchor is stale keeps the branch
        legible even though the source passage has moved on. It is never
        hidden: an unreachable branch is worse than an approximate one.
      */}
      <span className="hidden truncate text-gray-500 sm:inline">
        {stale ? `“${anchor.excerpt}”` : `“${resolution.text}”`}
      </span>
    </button>
  )
}

export default ThreadStub
