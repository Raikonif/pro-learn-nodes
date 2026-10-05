import { useEffect, useState, type ReactNode } from 'react'

import {
  chooseFolder,
  describeProblem,
  dismissStartupNotices,
  getDataLocation,
  recoverStartup,
  type RecoveryAction,
  type StartOutcome,
} from '../data-location-api'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * How the desktop shell's start went, shown before anything else.
 *
 * A start whose data was missing or damaged, with no good copy to restore,
 * replaces the window with a recovery screen: nothing behind it can work.
 * A start that restored something lets the app through and says what it did.
 * In the browser build there is no shell to ask, and children render as usual.
 */
function DataStartupGate({ children, reload = () => window.location.reload() }: { children: ReactNode; reload?: () => void }) {
  const [startup, setStartup] = useState<StartOutcome | null>(null)

  useEffect(() => {
    let live = true
    getDataLocation()
      .then((info) => {
        if (live && info.available) setStartup(info.startup)
      })
      .catch(() => {
        // The shell could not be asked; the app reports its own backend state.
      })
    return () => {
      live = false
    }
  }, [])

  if (startup?.outcome === 'failed') {
    return <RecoveryScreen outcome={startup} onRecovered={reload} onFailedAgain={setStartup} />
  }

  const notices = startup?.outcome === 'ready' ? startup.notices : []
  return (
    <>
      {notices.length > 0 ? (
        <div
          role="status"
          data-testid="data-startup-notices"
          className="fixed inset-x-0 top-0 z-50 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950"
        >
          <div className="mx-auto flex max-w-3xl items-start gap-3">
            <ul className="flex-1 space-y-1">
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setStartup((current) => (current?.outcome === 'ready' ? { ...current, notices: [] } : current))
                void dismissStartupNotices().catch(() => {})
              }}
              className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {children}
    </>
  )
}

function RecoveryScreen({
  outcome,
  onRecovered,
  onFailedAgain,
}: {
  outcome: Extract<StartOutcome, { outcome: 'failed' }>
  onRecovered: () => void
  onFailedAgain: (outcome: StartOutcome) => void
}) {
  const [working, setWorking] = useState<RecoveryAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: RecoveryAction): Promise<void> {
    setError(null)
    let folder: string | undefined
    if (action === 'folder') {
      try {
        folder = (await chooseFolder('Choose the folder that holds your Learn Nodes data')) ?? undefined
      } catch (failure) {
        setError(describe(failure))
        return
      }
      if (folder === undefined) return
    }
    setWorking(action)
    try {
      const next = await recoverStartup(action, folder)
      if (next.outcome === 'ready') onRecovered()
      else onFailedAgain(next)
    } catch (failure) {
      setError(describe(failure))
    } finally {
      setWorking(null)
    }
  }

  const button =
    'rounded border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50'

  return (
    <main
      data-testid="data-recovery-screen"
      className="flex h-screen items-center justify-center overflow-y-auto bg-gray-50 p-6"
    >
      <div role="alertdialog" aria-labelledby="data-recovery-title" className="w-full max-w-lg rounded-lg bg-white p-5 shadow">
        <h1 id="data-recovery-title" className="text-base font-semibold text-gray-900">
          Learn Nodes cannot open your data
        </h1>
        <p className="mt-2 text-sm text-gray-800">{describeProblem(outcome.problem)}</p>
        <p className="mt-1 break-all font-mono text-xs text-gray-600">{outcome.path}</p>
        {outcome.notices.map((notice) => (
          <p key={notice} className="mt-1 text-xs text-gray-600">
            {notice}
          </p>
        ))}
        <p className="mt-3 text-xs text-gray-600">
          No copy of it could be restored. Nothing has been replaced: if the folder is on a drive that is not
          connected, connect it and retry.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={working !== null} onClick={() => void act('retry')} className={button}>
            {working === 'retry' ? 'Retrying…' : 'Retry'}
          </button>
          <button type="button" disabled={working !== null} onClick={() => void act('folder')} className={button}>
            {working === 'folder' ? 'Opening…' : 'Choose another folder…'}
          </button>
          <button type="button" disabled={working !== null} onClick={() => void act('default')} className={button}>
            {working === 'default' ? 'Starting…' : 'Start on the default folder'}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  )
}

export default DataStartupGate
