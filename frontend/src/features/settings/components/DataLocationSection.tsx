import { useCallback, useEffect, useState } from 'react'

import {
  checkTarget,
  chooseFolder,
  formatBytes,
  getDataLocation,
  moveData,
  retryRemoval,
  revealFolder,
  type DataLocationInfo,
  type MoveOutcome,
  type MoveProgress,
  type TargetCheck,
} from '../data-location-api'

type Step =
  | { kind: 'idle' }
  | { kind: 'checking'; target: string }
  | { kind: 'confirm'; target: string; check: TargetCheck }
  | { kind: 'refused'; target: string; reason: string }
  | { kind: 'moving'; target: string; progress: MoveProgress | null }
  | { kind: 'done'; outcome: MoveOutcome }
  | { kind: 'error'; message: string }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Where everything Learn Nodes stores and can change is kept, and moving it
 * elsewhere. The shell copies, verifies, switches, and only then empties the
 * previous folder; what it could not remove is listed here to retry.
 */
function DataLocationSection() {
  const [info, setInfo] = useState<DataLocationInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [leftovers, setLeftovers] = useState<string[]>([])
  const [retrying, setRetrying] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await getDataLocation()
      setInfo(next)
      setLeftovers(next.leftovers)
      setLoadError(null)
    } catch (error) {
      setLoadError(describe(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function pick(): Promise<void> {
    let target: string | null
    try {
      target = await chooseFolder('Choose where Learn Nodes keeps its data')
    } catch (error) {
      setStep({ kind: 'error', message: describe(error) })
      return
    }
    if (target === null) return
    setStep({ kind: 'checking', target })
    try {
      const check = await checkTarget(target)
      setStep(
        check.ok
          ? { kind: 'confirm', target, check }
          : { kind: 'refused', target, reason: check.reason ?? 'That folder cannot be used.' },
      )
    } catch (error) {
      setStep({ kind: 'error', message: describe(error) })
    }
  }

  async function move(target: string): Promise<void> {
    setStep({ kind: 'moving', target, progress: null })
    try {
      const outcome = await moveData(target, (progress) =>
        setStep((current) => (current.kind === 'moving' ? { ...current, progress } : current)),
      )
      setStep({ kind: 'done', outcome })
      if (outcome.outcome === 'completed') setLeftovers(outcome.leftovers)
      await refresh()
    } catch (error) {
      setStep({ kind: 'error', message: describe(error) })
      await refresh()
    }
  }

  async function retry(): Promise<void> {
    setRetrying(true)
    try {
      setLeftovers(await retryRemoval())
    } catch (error) {
      setStep({ kind: 'error', message: describe(error) })
    } finally {
      setRetrying(false)
    }
  }

  if (loadError) {
    return (
      <section aria-label="Data location" className="mb-4">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Data location</h3>
        <p role="alert" className="text-sm text-red-700">
          Could not read where the data is kept: {loadError}
        </p>
      </section>
    )
  }
  if (info === null) {
    return (
      <section aria-label="Data location" className="mb-4">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Data location</h3>
        <p className="text-sm text-gray-600">Loading…</p>
      </section>
    )
  }

  const busy = step.kind === 'checking' || step.kind === 'moving'

  return (
    <section aria-label="Data location" className="mb-4 rounded border border-gray-200 p-3">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Data location</h3>
      {!info.available ? (
        <p data-testid="data-location-unavailable" className="text-xs text-gray-600">
          Not available here. {info.unavailableReason}
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-600">
            Your sessions, practice, backups, and each session's agent folder are kept in:
          </p>
          <p data-testid="data-location-path" className="mt-1 break-all font-mono text-xs text-gray-900">
            {info.path}
            {info.isDefault ? <span className="ml-1 font-sans text-gray-500">(default)</span> : null}
          </p>
          {info.contents ? (
            <p className="mt-1 text-xs text-gray-600">
              {formatBytes(info.contents.totalBytes)} in all: database {formatBytes(info.contents.databaseBytes)},{' '}
              {info.contents.backups} {info.contents.backups === 1 ? 'backup' : 'backups'},{' '}
              {info.contents.nodeFolders} session {info.contents.nodeFolders === 1 ? 'folder' : 'folders'}.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-gray-500">
            Your sign-in and agent credentials stay in the system keychain and are not moved.
          </p>

          {step.kind === 'idle' || step.kind === 'refused' || step.kind === 'done' || step.kind === 'error' ? (
            <button
              type="button"
              disabled={busy || info.moving}
              onClick={() => void pick()}
              className="mt-2 rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              Change…
            </button>
          ) : null}

          {step.kind === 'checking' ? (
            <p role="status" className="mt-2 text-xs text-gray-600">
              Checking {step.target}…
            </p>
          ) : null}

          {step.kind === 'refused' ? (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {step.target} cannot be used: {step.reason}
            </p>
          ) : null}

          {step.kind === 'confirm' ? (
            <div data-testid="data-location-confirm" className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-800">
              <p>
                Move {formatBytes(step.check.neededBytes)} to <span className="break-all font-mono">{step.target}</span>?
                Learn Nodes stops while it copies, checks every file, switches to the new folder, and then empties
                the current one.
              </p>
              {step.check.warnings.map((warning) => (
                <p key={warning} role="note" className="mt-1 text-amber-800">
                  {warning}
                </p>
              ))}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void move(step.target)}
                  className="rounded bg-gray-900 px-2 py-0.5 font-medium text-white hover:bg-gray-700"
                >
                  {step.check.warnings.length > 0 ? 'Move anyway' : 'Move data'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep({ kind: 'idle' })}
                  className="rounded border border-gray-300 px-2 py-0.5 hover:bg-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {step.kind === 'moving' ? (
            <div role="status" className="mt-2 text-xs text-gray-700">
              <p>Moving the data to {step.target}… Learn Nodes is unavailable until it finishes.</p>
              <progress
                aria-label="Data copied"
                className="mt-1 h-2 w-full"
                value={step.progress?.copiedBytes ?? 0}
                max={Math.max(step.progress?.totalBytes ?? 1, 1)}
              />
              {step.progress ? (
                <p className="mt-0.5 text-gray-500">
                  {formatBytes(step.progress.copiedBytes)} of {formatBytes(step.progress.totalBytes)}
                </p>
              ) : null}
            </div>
          ) : null}

          {step.kind === 'done' && step.outcome.outcome === 'completed' ? (
            <p role="status" className="mt-2 text-xs text-green-800">
              The data now lives in {step.outcome.path}.
            </p>
          ) : null}
          {step.kind === 'done' && step.outcome.outcome === 'abandoned' ? (
            <p role="alert" className="mt-2 text-xs text-red-700">
              The move did not happen. {step.outcome.reason}
            </p>
          ) : null}
          {step.kind === 'error' ? (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {step.message}
            </p>
          ) : null}

          {leftovers.length > 0 ? (
            <LeftoversNotice
              folder={info.previous}
              leftovers={leftovers}
              retrying={retrying}
              onRetry={() => void retry()}
            />
          ) : null}
        </>
      )}
    </section>
  )
}

export function LeftoversNotice({
  folder,
  leftovers,
  retrying,
  onRetry,
}: {
  folder: string | null
  leftovers: string[]
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <div role="alert" data-testid="data-location-leftovers" className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
      <p>
        The data was moved, but {leftovers.length === 1 ? 'one item' : `${leftovers.length} items`} could not be
        removed from the previous folder{folder ? ` (${folder})` : ''}. Nothing in the new folder depends on them.
      </p>
      <ul className="mt-1 max-h-24 overflow-y-auto font-mono">
        {leftovers.map((line) => (
          <li key={line} className="break-all">
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="rounded border border-amber-400 bg-white px-2 py-0.5 font-medium hover:bg-amber-100 disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        {folder ? (
          <button
            type="button"
            onClick={() => void revealFolder(folder)}
            className="rounded border border-amber-400 bg-white px-2 py-0.5 font-medium hover:bg-amber-100"
          >
            Reveal in Finder
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default DataLocationSection
