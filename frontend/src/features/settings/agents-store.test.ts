import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentsStore } from './agents-store'

const OFFER = { known: true, model: null, effort: null, fast: null, mode: null, commands: [] }

function stubOffers(...bodies: unknown[]) {
  const queue = [...bodies]
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => {
    const body = queue.shift()
    if (body instanceof Error) return Promise.reject(body)
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => useAgentsStore.getState().discard())
afterEach(() => vi.unstubAllGlobals())

describe('agents store — offers (agent-session-controls 4.1)', () => {
  it('caches one offer per agent: ensuring twice fetches once', async () => {
    const fetchMock = stubOffers(OFFER)

    await useAgentsStore.getState().ensureOffer('agent-1')
    await useAgentsStore.getState().ensureOffer('agent-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useAgentsStore.getState().offers['agent-1']).toEqual({ status: 'ready', offer: OFFER, error: null })
  })

  it('refetches on demand, keeping the last offer on screen while it loads', async () => {
    const fetchMock = stubOffers({ ...OFFER, known: false }, OFFER)
    await useAgentsStore.getState().ensureOffer('agent-1')

    const refreshing = useAgentsStore.getState().refreshOffer('agent-1')
    expect(useAgentsStore.getState().offers['agent-1']?.offer?.known).toBe(false)
    await refreshing

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(useAgentsStore.getState().offers['agent-1']?.offer?.known).toBe(true)
  })

  it('records a failure without losing an offer it already had', async () => {
    stubOffers(OFFER, new TypeError('Failed to fetch'))
    await useAgentsStore.getState().ensureOffer('agent-1')

    await useAgentsStore.getState().refreshOffer('agent-1')

    expect(useAgentsStore.getState().offers['agent-1']).toEqual({
      status: 'error',
      offer: OFFER,
      error: 'Failed to fetch',
    })
  })

  it('forgets offers with the account, and ignores an answer arriving after', async () => {
    stubOffers(OFFER)
    const pending = useAgentsStore.getState().ensureOffer('agent-1')
    useAgentsStore.getState().discard()
    await pending

    expect(useAgentsStore.getState().offers).toEqual({})
  })
})
