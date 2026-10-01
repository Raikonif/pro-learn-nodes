import { useEffect, useId, useState } from 'react'

import type { Memory } from '../memory-api'
import { useMemoryStore } from '../memory-store'

const buttonPrimary =
  'rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60'
const buttonSecondary =
  'rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60'
const fieldClass =
  'w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs one decision and keeps its failure next to the control that made it,
 * so a refused accept is never mistaken for a silent success.
 */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  async function run(action: () => Promise<void>, onDone?: () => void): Promise<void> {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      onDone?.()
    } catch (error) {
      setProblem(`Your decision could not be saved (${describe(error)}).`)
    } finally {
      setBusy(false)
    }
  }
  return { busy, problem, run }
}

function Problem({ message }: { message: string | null }) {
  if (message === null) return null
  return (
    <p role="alert" className="text-xs text-red-700">
      {message}
    </p>
  )
}

function Provenance({ memory }: { memory: Memory }) {
  return (
    <p className="text-[11px] text-gray-500">
      Proposed by {memory.proposedBy}
      {memory.sourceTitle ? <> · from “{memory.sourceTitle}”</> : memory.sourceNodeId ? ' · from a session' : null}
    </p>
  )
}

function TopicBadge({ topic }: { topic: string | null }) {
  if (topic === null) return null
  return (
    <span className="self-start rounded bg-gray-100 px-1.5 font-mono text-[10px] text-gray-700">{topic}</span>
  )
}

function TextEditor({
  initial,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  initial: string
  confirmLabel: string
  busy: boolean
  onConfirm: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  return (
    <div className="flex flex-col gap-1">
      <textarea
        aria-label="Memory text"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={fieldClass}
      />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={busy || text.trim() === ''}
          onClick={() => onConfirm(text.trim())}
          className={buttonPrimary}
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className={buttonSecondary}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** A proposal waiting on the learner: accept, edit and accept, or reject. */
function Proposal({ memory }: { memory: Memory }) {
  const accept = useMemoryStore((s) => s.accept)
  const reject = useMemoryStore((s) => s.reject)
  const { busy, problem, run } = useAction()
  const [editing, setEditing] = useState(false)

  return (
    <article aria-label={memory.text} className="flex flex-col gap-1 rounded border border-gray-200 p-2">
      <TopicBadge topic={memory.topic} />
      {memory.revises ? (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <div data-testid="memory-current" className="rounded bg-gray-50 p-1">
            <p className="text-[10px] font-semibold uppercase text-gray-500">Remembered now</p>
            <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{memory.revises.text}</p>
          </div>
          <div data-testid="memory-proposed" className="rounded bg-indigo-50 p-1">
            <p className="text-[10px] font-semibold uppercase text-indigo-700">Proposed revision</p>
            <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{memory.text}</p>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{memory.text}</p>
      )}
      <Provenance memory={memory} />

      {editing ? (
        <TextEditor
          initial={memory.text}
          confirmLabel="Accept edited"
          busy={busy}
          onConfirm={(text) => void run(() => accept(memory.id, text))}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => accept(memory.id))}
            className={buttonPrimary}
          >
            Accept
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing(true)} className={buttonSecondary}>
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => reject(memory.id))}
            className={buttonSecondary}
          >
            Reject
          </button>
        </div>
      )}
      <Problem message={problem} />
    </article>
  )
}

function formatDate(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

/** A memory agents receive: edit, remove (after a confirmation), and its history. */
function Remembered({ memory }: { memory: Memory }) {
  const edit = useMemoryStore((s) => s.edit)
  const remove = useMemoryStore((s) => s.remove)
  const { busy, problem, run } = useAction()
  const [mode, setMode] = useState<'view' | 'editing' | 'confirm-remove'>('view')

  return (
    <article aria-label={memory.text} className="flex flex-col gap-1 rounded border border-gray-200 p-2">
      <TopicBadge topic={memory.topic} />
      {mode === 'editing' ? (
        <TextEditor
          initial={memory.text}
          confirmLabel="Save"
          busy={busy}
          onConfirm={(text) => void run(() => edit(memory.id, text), () => setMode('view'))}
          onCancel={() => setMode('view')}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{memory.text}</p>
      )}
      <Provenance memory={memory} />

      {memory.history.length > 0 ? (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer">Earlier versions ({memory.history.length})</summary>
          <ol className="mt-1 flex flex-col gap-0.5 border-l border-gray-200 pl-2">
            {memory.history.map((entry, index) => (
              <li key={index} className="flex flex-col">
                <span className="whitespace-pre-wrap break-words text-gray-700">{entry.text}</span>
                {entry.decidedAt ? <span className="text-[10px] text-gray-400">{formatDate(entry.decidedAt)}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {mode === 'view' ? (
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setMode('editing')} className={buttonSecondary}>
            Edit
          </button>
          <button type="button" onClick={() => setMode('confirm-remove')} className={buttonSecondary}>
            Remove
          </button>
        </div>
      ) : null}
      {mode === 'confirm-remove' ? (
        <div className="flex flex-wrap items-center gap-1 rounded bg-red-50 p-1 text-xs text-red-900">
          <span>Remove this memory? After that no agent will receive it.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => remove(memory.id))}
            className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            Remove for good
          </button>
          <button type="button" onClick={() => setMode('view')} className={buttonSecondary}>
            Keep it
          </button>
        </div>
      ) : null}
      <Problem message={problem} />
    </article>
  )
}

/** Hands the learner the Markdown as a `memory.md` download. */
function download(markdown: string): void {
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'memory.md'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function ExportButton() {
  const exportMarkdown = useMemoryStore((s) => s.exportMarkdown)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setProblem(null)
    try {
      download(await exportMarkdown())
    } catch (error) {
      setProblem(`Could not export memory (${describe(error)}).`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" disabled={busy} onClick={() => void run()} className={buttonSecondary}>
        Export as Markdown
      </button>
      <Problem message={problem} />
    </div>
  )
}

/**
 * What agents may remember about the learner, and the learner's decisions on
 * it. A dialog like agent settings: visited to decide, then left.
 *
 * Nothing proposed is in effect until accepted here; accepted memory is
 * readable by every agent in every session of this account.
 */
function MemoryPanel() {
  const panelOpen = useMemoryStore((s) => s.panelOpen)
  const closePanel = useMemoryStore((s) => s.closePanel)
  const load = useMemoryStore((s) => s.load)
  const status = useMemoryStore((s) => s.status)
  const error = useMemoryStore((s) => s.error)
  const pending = useMemoryStore((s) => s.pending)
  const accepted = useMemoryStore((s) => s.accepted)
  const headingId = useId()

  useEffect(() => {
    if (panelOpen) void load()
  }, [panelOpen, load])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, closePanel])

  if (!panelOpen) return null

  const loading = status === 'idle' || status === 'loading'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl"
      >
        <header className="mb-2 flex items-center justify-between">
          <h2 id={headingId} className="text-base font-semibold text-gray-900">
            Memory
          </h2>
          <button
            type="button"
            onClick={closePanel}
            className="rounded px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </header>
        <p className="mb-3 text-xs text-gray-600">
          Agents may propose what you know or have worked on. Nothing is remembered until you accept it; what you
          accept is readable by every agent, in every session.
        </p>

        {status === 'error' ? (
          <p role="alert" className="text-sm text-red-700">
            Could not load memory: {error}
          </p>
        ) : loading ? (
          <p role="status" className="text-sm text-gray-600">
            Loading memory…
          </p>
        ) : (
          <>
            <section aria-label="Pending proposals" className="mb-4 flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Waiting for you</h3>
              {pending.length === 0 ? (
                <p className="text-xs text-gray-600">No proposals waiting.</p>
              ) : (
                pending.map((memory) => <Proposal key={memory.id} memory={memory} />)
              )}
            </section>

            <section aria-label="Accepted memories" className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Remembered</h3>
                {accepted.length > 0 ? <ExportButton /> : null}
              </div>
              {accepted.length === 0 ? (
                <p className="text-xs text-gray-600">Nothing remembered yet.</p>
              ) : (
                accepted.map((memory) => <Remembered key={memory.id} memory={memory} />)
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

export default MemoryPanel
