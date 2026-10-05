import { useEffect, useId, useState } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { PendingPermission } from '../permissions-api'
import { usePermissionsStore } from '../permissions-store'

import PermissionRequestCard from './PermissionRequestCard'

/** How often pending requests are re-read while any may be waiting. */
export const PENDING_POLL_MS = 3000

/**
 * The workspace-level count of requests the learner cannot see: those from a
 * conversation not on screen. A request is never lost or failed for being out
 * of view, so this is where it is found — and answered, in place.
 *
 * `watching` is whether any turn is running: requests can only arrive then,
 * so it decides, with anything still pending, whether to keep re-reading.
 */
function PermissionIndicator({ watching }: { watching: boolean }) {
  const pending = usePermissionsStore((s) => s.pending)
  const refreshPending = usePermissionsStore((s) => s.refreshPending)
  const openThreadId = useWorkspaceStore((s) => s.openThreadId)
  const [open, setOpen] = useState(false)
  const panelId = useId()

  const offScreen = pending.filter((request) => request.threadId !== openThreadId)
  const polling = watching || pending.length > 0

  useEffect(() => {
    void refreshPending()
  }, [refreshPending])

  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => void refreshPending(), PENDING_POLL_MS)
    return () => clearInterval(timer)
  }, [polling, refreshPending])

  useEffect(() => {
    if (offScreen.length === 0) setOpen(false)
  }, [offScreen.length])

  if (offScreen.length === 0) return null

  const count = offScreen.length
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        data-testid="permission-indicator"
        className="flex items-center gap-1 rounded-full bg-sky-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-sky-700"
      >
        {count} {count === 1 ? 'agent asks' : 'agents ask'} permission
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Waiting permission requests"
          className="absolute right-0 z-40 mt-1 max-h-96 w-80 max-w-[90vw] overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
        >
          <ul className="flex flex-col gap-2">
            {offScreen.map((request) => (
              <li key={request.requestId}>
                <PendingEntry request={request} onOpened={() => setOpen(false)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function PendingEntry({ request, onOpened }: { request: PendingPermission; onOpened: () => void }) {
  const decide = usePermissionsStore((s) => s.decide)
  const busy = usePermissionsStore((s) => Boolean(s.answering[request.requestId]))
  const openSessionAt = useWorkspaceStore((s) => s.openSessionAt)
  const [error, setError] = useState<string | null>(null)

  async function answer(allow: boolean, remember: boolean) {
    setError(null)
    try {
      await decide(request.requestId, allow, remember)
    } catch {
      setError('The answer could not be sent. Try again.')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <PermissionRequestCard
        request={request}
        busy={busy}
        error={error}
        onAnswer={(allow, remember) => void answer(allow, remember)}
        context={`${request.nodeTitle} · ${request.agentName}`}
      />
      <button
        type="button"
        onClick={() => {
          onOpened()
          void openSessionAt(request.nodeId, request.threadId)
        }}
        className="self-start text-[11px] font-medium text-sky-800 underline hover:text-sky-950"
      >
        Open {request.nodeTitle} →
      </button>
    </div>
  )
}

export default PermissionIndicator
