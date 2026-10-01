import { useState } from 'react'

import { signOut } from '../account-api'
import { useAccountStore, type Profile } from '../account-store'

/**
 * What to call this account on screen.
 *
 * Every field a provider supplies for display is nullable, so the fallback
 * chain ends at the one thing an identity always carries: where it came from.
 * "dev account" is a poor name but a true one, and it keeps the affordance from
 * rendering an empty element the learner cannot aim at.
 */
function identityLabel(profile: Profile): string {
  return profile.displayName ?? profile.email ?? `${profile.provider} account`
}

/**
 * The active account, shown in the workspace chrome.
 *
 * Rendered inside the workspace header beside `BackendStatus`, not inside the
 * three-pane layout below it: the workspace has exactly three panes and this
 * must not become a fourth. The header already exists and is not a pane, so
 * this needs no positioning of its own — an overlay would have to be kept from
 * colliding with whatever the panes render underneath it.
 */
function AccountAffordance() {
  const profile = useAccountStore((state) => state.activeProfile)
  const clearActiveProfile = useAccountStore((state) => state.clearActiveProfile)
  const [pending, setPending] = useState(false)

  if (profile === null) return null

  async function handleSignOut(): Promise<void> {
    setPending(true)
    try {
      await signOut()
    } catch {
      // Deliberately ignored. Sign-out is idempotent server-side, so a request
      // that never landed can be repeated later — but a learner who asked to
      // leave an account must not be held in it because the backend was
      // unreachable.
    } finally {
      clearActiveProfile()
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      <span data-testid="account-identity" className="max-w-[16rem] truncate font-medium">
        {identityLabel(profile)}
      </span>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={pending}
        className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
      >
        Sign out
      </button>
    </div>
  )
}

export default AccountAffordance
