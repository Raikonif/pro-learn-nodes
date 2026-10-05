import { useEffect, useState } from 'react'

import { rememberLabel } from '../permissions-api'
import { usePermissionsStore } from '../permissions-store'

/**
 * Every decision the learner asked to have remembered, each revocable — after
 * which the agent asks again. Shown in Settings, beside the agents they apply to.
 */
function RememberedPermissions() {
  const remembered = usePermissionsStore((s) => s.remembered)
  const status = usePermissionsStore((s) => s.rememberedStatus)
  const loadRemembered = usePermissionsStore((s) => s.loadRemembered)
  const revoke = usePermissionsStore((s) => s.revoke)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    void loadRemembered()
  }, [loadRemembered])

  async function revokeOne(id: string) {
    setFailed(null)
    try {
      await revoke(id)
    } catch {
      setFailed(id)
    }
  }

  return (
    <section aria-label="Remembered permissions" className="mb-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Remembered permissions</h3>
      {status === 'error' ? (
        <p className="text-sm text-red-700">Could not load remembered permissions.</p>
      ) : remembered.length === 0 ? (
        <p className="text-sm text-gray-600">
          {status === 'loading' || status === 'idle'
            ? 'Loading…'
            : 'None. When an agent asks, you can choose to remember your answer for that node.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {remembered.map((decision) => (
            <li
              key={decision.id}
              aria-label={`${rememberLabel(decision.kind, decision.allow)} — ${decision.nodeTitle} on ${decision.agentName}`}
              className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1 text-xs"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium text-gray-900">{rememberLabel(decision.kind, decision.allow)}</span>
                <span className="text-gray-600">
                  {' '}
                  — {decision.nodeTitle} on {decision.agentName}
                </span>
                {failed === decision.id ? (
                  <span className="block text-red-700">Could not revoke. Try again.</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => void revokeOne(decision.id)}
                className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-100"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default RememberedPermissions
