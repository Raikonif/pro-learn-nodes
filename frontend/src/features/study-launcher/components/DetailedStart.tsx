import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { NodeMode } from '../../../shared/lib/workspace-types'

/** In the order a learner meets them, not the schema's. */
export const LEARNING_MODES: readonly NodeMode[] = ['Explore', 'Deepen', 'Review', 'Practice', 'Quiz']

export type DetailedStartProps = {
  variant?: 'compact' | 'prominent'
}

const TRIGGER_CLASSES = {
  compact:
    'rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100',
  prominent:
    'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100',
} as const

/**
 * Starts a session with a topic and a learning mode chosen first.
 *
 * Neither field has to be touched: the mode defaults to Explore, and an empty
 * topic is sent as no topic at all, so the session is titled from its first
 * message exactly as a quick start is. Dismissing — Cancel, Escape, or the
 * backdrop — creates nothing.
 */
function DetailedStart({ variant = 'compact' }: DetailedStartProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={TRIGGER_CLASSES[variant]}>
        Start with a topic…
      </button>
      {open ? <DetailedStartDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function DetailedStartDialog({ onClose }: { onClose: () => void }) {
  const createRootNode = useWorkspaceStore((s) => s.createRootNode)
  const [topic, setTopic] = useState('')
  const [mode, setMode] = useState<NodeMode>('Explore')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const headingId = useId()
  const topicId = useId()
  const modeId = useId()
  const topicRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    topicRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const title = topic.trim()
      await createRootNode(title ? { title, mode } : { mode })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setPending(false)
    }
  }

  return (
    <div
      data-testid="detailed-start-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-8"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg bg-white p-4 shadow-xl"
      >
        <h2 id={headingId} className="text-base font-semibold text-gray-900">
          Start a session
        </h2>

        <div className="flex flex-col gap-1">
          <label htmlFor={topicId} className="text-xs font-medium text-gray-600">
            Topic
          </label>
          <input
            ref={topicRef}
            id={topicId}
            type="text"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Leave empty to title it from your first message"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={modeId} className="text-xs font-medium text-gray-600">
            Mode
          </label>
          <select
            id={modeId}
            value={mode}
            onChange={(event) => setMode(event.target.value as NodeMode)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
          >
            {LEARNING_MODES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-red-700">
            Could not start a session: {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Start
          </button>
        </div>
      </form>
    </div>
  )
}

export default DetailedStart
