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
 * Phase 1 placeholder surface: renders the Learn Nodes title and a single
 * backend status indicator. The indicator reflects the first attempt only —
 * no polling, no retries (Phase 4 will add a real connection manager).
 *
 * Implementation note: the React 19 `use()` hook suspends on plain
 * Promises but does not reliably resume them in test environments without
 * a framework-integrated cache, so we stay with `useState` + `useEffect`
 * and upgrade the React 19 way: an `AbortController` for StrictMode-safe
 * cancellation and a `startTransition` to keep the status change
 * non-blocking.
 */
function Placeholder() {
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Learn Nodes</h1>
        <p className="text-gray-500 text-sm">Phase 1 — Project Skeleton</p>
        <div className="mt-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-700 text-sm flex items-center justify-center gap-2">
            <span
              id="backend-status"
              aria-hidden="true"
              className={`inline-block w-2 h-2 rounded-full ${DOT_COLORS[status]}`}
            />
            <span id="backend-message">{LABELS[status]}</span>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Placeholder