import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectIsSignedIn, useAccountStore, type Profile } from './account-store'

const LEARNER: Profile = {
  id: 'p-1',
  provider: 'dev',
  subject: 'subject-alice',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
}

const OTHER_LEARNER: Profile = {
  id: 'p-2',
  provider: 'dev',
  subject: 'subject-bob',
  email: null,
  displayName: null,
  avatarUrl: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('account store', () => {
  beforeEach(() => {
    useAccountStore.getState().reset()
  })

  it('is signed out until an account is made active', () => {
    const state = useAccountStore.getState()
    expect(state.activeProfile).toBeNull()
    expect(selectIsSignedIn(state)).toBe(false)
  })

  it('holds the account that was made active', () => {
    useAccountStore.getState().setActiveProfile(LEARNER)

    const state = useAccountStore.getState()
    expect(state.activeProfile).toEqual(LEARNER)
    expect(selectIsSignedIn(state)).toBe(true)
  })

  it('returns to signed out when the active account is cleared', () => {
    useAccountStore.getState().setActiveProfile(LEARNER)

    useAccountStore.getState().clearActiveProfile()

    const state = useAccountStore.getState()
    expect(state.activeProfile).toBeNull()
    expect(selectIsSignedIn(state)).toBe(false)
  })

  it('replaces the active account rather than accumulating a second one', () => {
    useAccountStore.getState().setActiveProfile(LEARNER)

    useAccountStore.getState().setActiveProfile(OTHER_LEARNER)

    const state = useAccountStore.getState()
    expect(state.activeProfile).toEqual(OTHER_LEARNER)
    // At most one account is active, so the displaced one must be gone from the
    // store entirely — not merely shadowed by a newer field.
    expect(JSON.stringify(state)).not.toContain(LEARNER.subject)
  })
})

describe('account store session loading', () => {
  beforeEach(() => {
    useAccountStore.getState().reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not claim to be signed out before the session is read', () => {
    // The distinction the root view depends on: "nobody is signed in" and
    // "we have not asked yet" must never look the same.
    expect(useAccountStore.getState().sessionStatus).toBe('unknown')
  })

  it('records the active account and the gate the server reports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ profile: LEARNER, mechanisms: ['local', 'dev'] }))),
    )

    await useAccountStore.getState().loadSession()

    const state = useAccountStore.getState()
    expect(state.activeProfile).toEqual(LEARNER)
    expect(state.mechanisms).toEqual(['local', 'dev'])
    expect(state.sessionStatus).toBe('ready')
  })

  it('settles on signed out when the session cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )

    await useAccountStore.getState().loadSession()

    const state = useAccountStore.getState()
    expect(state.activeProfile).toBeNull()
    expect(state.mechanisms).toEqual([])
    // Still 'ready': staying 'unknown' would leave the window stuck on the
    // startup splash with nothing left to wait for.
    expect(state.sessionStatus).toBe('ready')
  })

  it('keeps the reported gate when the learner signs out', () => {
    useAccountStore.getState().applySession({ profile: LEARNER, mechanisms: ['local', 'dev'] })

    useAccountStore.getState().clearActiveProfile()

    const state = useAccountStore.getState()
    expect(state.activeProfile).toBeNull()
    // Signing out does not close the gate — the sign-in surface still needs to
    // know it can offer development sign-in.
    expect(state.mechanisms).toEqual(['local', 'dev'])
    expect(state.sessionStatus).toBe('ready')
  })
})
