import { useId, useState } from 'react'

import { kindPhrase } from '../permissions-api'

export type PermissionRequestView = {
  title: string
  kind: string | null
  locations: string[]
  rememberable: boolean
  agentRemembers: boolean
}

/**
 * One request the agent is waiting on: what it would do, where, and the
 * learner's answer. The same card answers inline in the conversation and in
 * the workspace indicator, so a request reads the same wherever it is met.
 */
function PermissionRequestCard({
  request,
  busy = false,
  error = null,
  onAnswer,
  context = null,
}: {
  request: PermissionRequestView
  busy?: boolean
  error?: string | null
  onAnswer: (allow: boolean, remember: boolean) => void
  /** Where it came from, when that is not on screen: "Node · Agent". */
  context?: string | null
}) {
  const [remember, setRemember] = useState(false)
  const rememberId = useId()

  return (
    <div
      role="group"
      aria-label={`The agent asks to: ${request.title || kindPhrase(request.kind)}`}
      data-testid="permission-request"
      className="rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-950"
    >
      {context ? <p className="mb-0.5 text-[11px] text-sky-800">{context}</p> : null}
      <p>
        The agent asks to: <span className="font-medium">{request.title || 'do something it did not name'}</span>
        {request.kind ? <span className="ml-1 text-sky-800">({kindPhrase(request.kind)})</span> : null}
      </p>
      {request.locations.length > 0 ? (
        <ul aria-label="Affects" className="mt-1 max-h-20 overflow-y-auto font-mono text-[11px] text-sky-900">
          {request.locations.map((location) => (
            <li key={location} className="break-all">
              {location}
            </li>
          ))}
        </ul>
      ) : null}
      {request.agentRemembers ? (
        <p data-testid="agent-remembers" className="mt-1 text-amber-900">
          This agent offers no one-time answer, so it will remember this choice itself — outside Learn Nodes'
          remembered permissions.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(true, remember)}
          className="rounded bg-sky-700 px-2 py-0.5 font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          Allow
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(false, remember)}
          className="rounded border border-sky-400 bg-white px-2 py-0.5 font-medium text-sky-900 hover:bg-sky-100 disabled:opacity-50"
        >
          Refuse
        </button>
        {request.rememberable ? (
          <label htmlFor={rememberId} className="flex items-center gap-1">
            <input
              id={rememberId}
              type="checkbox"
              checked={remember}
              disabled={busy}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember for this node — answer {kindPhrase(request.kind)} here the same way
          </label>
        ) : null}
      </div>
      {error ? (
        <p role="status" className="mt-1 text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default PermissionRequestCard
