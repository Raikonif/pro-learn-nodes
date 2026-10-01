import { useState } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'

export type QuickStartButtonProps = {
  /** `compact` fits the left-rail header; `prominent` leads the empty workspace. */
  variant?: 'compact' | 'prominent'
}

const VARIANT_CLASSES = {
  compact:
    'rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100',
  prominent: 'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700',
} as const

/**
 * Starts a session at once: nothing is asked first. The session opens with its
 * composer focused, titled provisionally until its first message names it, on
 * the account's default agent and the default mode.
 */
function QuickStartButton({ variant = 'compact' }: QuickStartButtonProps) {
  const createRootNode = useWorkspaceStore((s) => s.createRootNode)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start(): Promise<void> {
    setPending(true)
    setError(null)
    try {
      await createRootNode()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void start()}
        disabled={pending}
        // Named apart from the session it creates, whose provisional title is
        // also "New session" — both sit in the left rail at once.
        aria-label="Start a new session"
        className={`${VARIANT_CLASSES[variant]} disabled:opacity-50`}
      >
        New session
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          Could not start a session: {error}
        </p>
      ) : null}
    </div>
  )
}

export default QuickStartButton
