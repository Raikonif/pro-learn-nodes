import { resolveAnchor } from '../../../shared/lib/anchor-resolver'
import { messageById } from '../../../shared/lib/fixtures'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { ChatThread } from '../../../shared/lib/workspace-types'

import { stubElementId } from './ThreadStub'

type ThreadBackLinkProps = {
  thread: ChatThread
}

/**
 * Header of an expanded spawned thread: names the passage it came from and
 * returns there.
 *
 * The scroll is deferred by a frame because the stub only exists in the DOM
 * once the source thread has re-rendered — scrolling inside the click handler
 * would look for an element that is still one render away. `scrollIntoView`
 * is called optionally because jsdom does not implement it.
 */
function ThreadBackLink({ thread }: ThreadBackLinkProps) {
  const graph = useWorkspaceStore((s) => s.graph)
  const openThread = useWorkspaceStore((s) => s.openThread)

  const anchor = thread.anchor
  if (!anchor) return null

  const sourceMessage = messageById(graph, anchor.messageId)
  const resolution = resolveAnchor(anchor, sourceMessage)
  const stale = resolution.status === 'stale'
  // The thread we came from is the thread that owns the anchored message.
  const sourceThreadId = sourceMessage?.threadId

  const goBack = () => {
    if (!sourceThreadId) return
    openThread(sourceThreadId)
    const scroll = () => {
      document.getElementById(stubElementId(thread.id))?.scrollIntoView?.({
        block: 'center',
      })
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scroll)
    } else {
      setTimeout(scroll, 0)
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      disabled={!sourceThreadId}
      aria-label={`Back to the source thread — from: ${resolution.text}`}
      className="mb-3 flex w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs text-gray-600 hover:border-gray-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span aria-hidden="true">↰</span>
      <span className="shrink-0 font-medium text-gray-500">from:</span>
      <span className="truncate italic">“{resolution.text}”</span>
      {stale ? (
        <span
          title="The source passage changed — showing the text this thread was branched from"
          className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
        >
          stale
        </span>
      ) : null}
    </button>
  )
}

export default ThreadBackLink
