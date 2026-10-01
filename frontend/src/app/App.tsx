import { useEffect, useRef } from 'react'

import { SignInSurface, useAccountStore } from '../features/account'
import { discardMemoryState } from '../features/memory'
import { discardPracticeState } from '../features/practice'
import { useAgentsStore } from '../features/settings'
import { useWorkspaceStore } from '../shared/lib/workspace-store'

import Workspace from './Workspace'

/**
 * App shell. The root view is decided by the account, not by a route: the
 * workspace while one is active, the sign-in surface while none is. A router
 * lands when there is a second full-window surface to route to (the study
 * launcher, Phase 13).
 */
function App() {
  const hydrate = useWorkspaceStore((state) => state.hydrate)
  const discardHydratedState = useWorkspaceStore((state) => state.discardHydratedState)
  const workspaceId = useWorkspaceStore((state) => state.workspaceId)
  const activeProfile = useAccountStore((state) => state.activeProfile)
  const sessionStatus = useAccountStore((state) => state.sessionStatus)
  const loadSession = useAccountStore((state) => state.loadSession)
  // `undefined` is "no account observed yet", distinct from the `null` of a
  // signed-out window: without that distinction the first paint would look
  // like a change away from an account that was never there.
  const observedProfileId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (sessionStatus === 'unknown') void loadSession()
  }, [loadSession, sessionStatus])

  // The two stores are joined here rather than inside either one: workspace
  // data is scoped to an account, but the workspace store has no business
  // knowing what an account is, and the account store has none holding the
  // workspace's material. The composition root is where they meet.
  useEffect(() => {
    const profileId = activeProfile?.id ?? null
    const previous = observedProfileId.current
    observedProfileId.current = profileId
    // Signing out discards too: a window with no account must not still be
    // holding the last one's nodes and conversations.
    // Registered agents are account-scoped too, so they go with it.
    if (previous !== undefined && previous !== profileId) {
      discardHydratedState()
      useAgentsStore.getState().discard()
      discardPracticeState()
      discardMemoryState()
    }
  }, [activeProfile, discardHydratedState])

  useEffect(() => {
    // Gated on the account as well as on the id: workspace data is scoped to
    // the active profile, so hydrating before one is known would fetch a
    // workspace that belongs to nobody.
    // Tests explicitly install fixture state through the store's reset seam.
    // Production starts with no workspace id and therefore always hydrates.
    if (activeProfile !== null && workspaceId === null) void hydrate()
  }, [activeProfile, hydrate, workspaceId])

  if (sessionStatus === 'unknown') {
    // Neither view yet. Showing the sign-in surface here would make a returning
    // learner watch a sign-in screen they never needed, every launch.
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p role="status" className="text-sm text-gray-600">
          Starting Learn Nodes…
        </p>
      </div>
    )
  }

  if (activeProfile === null) return <SignInSurface />

  // The affordance lives in the workspace header, not here: it is chrome, and
  // pairing it with `Workspace` as a sibling is what forced it to be an overlay.
  return <Workspace />
}

export default App
