import { useEffect, useState, useTransition } from 'react'

import apiClient, { HealthSchema } from '../shared/lib/api-client'

type Status = 'online' | 'offline'

const LABELS: Record<Status, string> = {
  online: 'Backend online',
  offline: 'Backend offline',
}

const DOT_COLORS: Record<Status, string> = {
  online: 'bg-green-500',
  offline: 'bg-red-500',
}

/**
 * Backend reachability indicator, shown in the workspace chrome.
 *
 * Carried over from the Phase 1 placeholder unchanged in behavior: it reflects
 * the FIRST attempt only — no polling, no retries. A real connection manager
 * arrives with the provider layer in Phase 4; until then a quietly retrying dot
 * would imply a liveness guarantee the app cannot make.
 *
 * The `#backend-status` / `#backend-message` ids are load-bearing: the
 * Playwright suite asserts against them.
 */
function BackendStatus() {
  const [status, setStatus] = useState<Status>('offline')
  const [, startTransition] = useTransition()

  useEffect(() => {
    const controller = new AbortController()
    apiClient
      .get('/health', { schema: HealthSchema })
      .then(() => {
        if (controller.signal.aborted) return
        startTransition(() => setStatus('online'))
      })
      .catch(() => {
        if (controller.signal.aborted) return
        startTransition(() => setStatus('offline'))
      })
    return () => controller.abort()
  }, [])

  return (
    <span className="flex items-center gap-2 text-xs text-gray-500">
      <span
        id="backend-status"
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${DOT_COLORS[status]}`}
      />
      <span id="backend-message">{LABELS[status]}</span>
    </span>
  )
}

export default BackendStatus
