import { create } from 'zustand'

import { DEV_MECHANISM, fetchSession, type Session } from './account-api'

/**
 * An account enrolled on this device.
 *
 * `provider` and `subject` together identify the account; `id` is only the
 * local handle for that pair. `email`, `displayName`, and `avatarUrl` are
 * display information that the provider may change between sign-ins, so they
 * are refreshed on the existing account and never used to tell accounts apart
 * — which is why all three are nullable and none of them is a key.
 */
export type Profile = {
  id: string
  provider: string
  subject: string
  email: string | null
  displayName: string | null
  avatarUrl: string | null
}

/**
 * Whether the server has been asked who is signed in.
 *
 * Three-valued on purpose, collapsed into two states plus a null profile:
 * "unknown" is not the same as "signed out". The root view has to tell them
 * apart, or a returning learner sees the sign-in surface flash by before the
 * session they already had comes back.
 */
export type SessionStatus = 'unknown' | 'ready'

export type AccountState = {
  activeProfile: Profile | null
  /**
   * Server-reported sign-in mechanisms, in the backend registry's order.
   *
   * Held as the list the server sent rather than reduced to flags here: the
   * surface decides what to render from it, and a mechanism added to the
   * backend needs no change in this store to reach the component that would
   * offer it. Empty means the backend could not be reached — never that a
   * reachable backend has no way in, which the backend guarantees against.
   */
  mechanisms: string[]
  sessionStatus: SessionStatus
  setActiveProfile: (profile: Profile) => void
  clearActiveProfile: () => void
  applySession: (session: Session) => void
  loadSession: () => Promise<void>
  /** Test-only seam back to a freshly-launched, session-unread store. */
  reset: () => void
}

const INITIAL = {
  activeProfile: null,
  mechanisms: [],
  sessionStatus: 'unknown',
} satisfies Pick<AccountState, 'activeProfile' | 'mechanisms' | 'sessionStatus'>

/**
 * At most one account is active at a time, so the active account is a single
 * slot rather than a collection with a pointer into it: replacing it is the
 * only way to sign a different account in, and there is no state in which two
 * accounts are both present.
 */
export const useAccountStore = create<AccountState>((set, get) => ({
  ...INITIAL,
  setActiveProfile: (profile) => set({ activeProfile: profile }),
  // Only the account is dropped: the mechanisms the server reported are a
  // property of the running backend, and the sign-in surface still needs them
  // to know what it can offer the learner who just signed out.
  clearActiveProfile: () => set({ activeProfile: null }),
  applySession: (session) =>
    set({
      activeProfile: session.profile,
      mechanisms: session.mechanisms,
      sessionStatus: 'ready',
    }),
  loadSession: async () => {
    try {
      get().applySession(await fetchSession())
    } catch {
      // The session route never answers 401, so a rejection means the backend
      // is unreachable rather than that nobody is signed in. Signed-out is
      // still the only safe answer — the workspace would otherwise render
      // without a confirmed account — and it must be a *settled* one, or the
      // window waits forever on a session that is never coming.
      set({ activeProfile: null, mechanisms: [], sessionStatus: 'ready' })
    }
  },
  reset: () => set({ ...INITIAL }),
}))

export function selectIsSignedIn(state: AccountState): boolean {
  return state.activeProfile !== null
}

/**
 * Whether development sign-in is on offer.
 *
 * A selector rather than a stored flag so there is one list to keep true and
 * the derived answer cannot drift from it.
 */
export function selectDevSignInAvailable(state: AccountState): boolean {
  return state.mechanisms.includes(DEV_MECHANISM)
}

/**
 * Whether the backend answered at all.
 *
 * Distinguishes an unreachable backend from a reachable one with nothing to
 * offer. Only the first is possible: the backend registers the local mechanism
 * unconditionally, so an empty list means the session read failed.
 */
export function selectBackendReachable(state: AccountState): boolean {
  return state.mechanisms.length > 0
}
