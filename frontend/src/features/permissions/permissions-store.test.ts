import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePermissionsStore } from './permissions-store'

const PENDING = {
  requestId: 'req-1',
  nodeId: 'n-1',
  threadId: 't-1',
  nodeTitle: 'Haskell',
  agentName: 'Codex',
  title: 'Write notes.md',
  kind: 'edit',
  locations: [],
  rememberable: true,
  agentRemembers: false,
}

const REMEMBERED = {
  id: 'd-1',
  nodeId: 'n-1',
  nodeTitle: 'Haskell',
  agentId: 'agent-codex',
  agentName: 'Codex',
  kind: 'edit',
  allow: true,
  createdAt: '2026-10-04T10:00:00Z',
}

function json(body: unknown, status = 200): Response {
  return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status })
}

/** `answers` maps "METHOD path" to a response factory, read on every call. */
function fakeBackend(answers: Record<string, () => Response>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const answer = answers[`${init?.method ?? 'GET'} ${url}`]
    return Promise.resolve(answer ? answer() : json({ detail: 'Not Found' }, 404))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => usePermissionsStore.getState().reset())
afterEach(() => vi.unstubAllGlobals())

describe('permissions store', () => {
  it('reads the account’s pending requests', async () => {
    fakeBackend({ 'GET /api/permissions/pending': () => json([PENDING]) })
    await usePermissionsStore.getState().refreshPending()
    expect(usePermissionsStore.getState().pending.map((r) => r.requestId)).toEqual(['req-1'])
  })

  it('a decided request leaves at once, and a stale read cannot bring it back', async () => {
    fakeBackend({
      'GET /api/permissions/pending': () => json([PENDING]),
      'POST /api/permissions/pending/req-1': () => json(null, 204),
    })
    await usePermissionsStore.getState().refreshPending()

    expect(await usePermissionsStore.getState().decide('req-1', true, false)).toBe('decided')
    expect(usePermissionsStore.getState().pending).toEqual([])

    // A read that started before the decision still lists it.
    await usePermissionsStore.getState().refreshPending()
    expect(usePermissionsStore.getState().pending).toEqual([])
  })

  it('a request answered elsewhere is gone, not an error', async () => {
    fakeBackend({
      'GET /api/permissions/pending': () => json([PENDING]),
      'POST /api/permissions/pending/req-1': () => json({ detail: 'Already decided' }, 409),
    })
    await usePermissionsStore.getState().refreshPending()

    expect(await usePermissionsStore.getState().decide('req-1', false, false)).toBe('gone')
    expect(usePermissionsStore.getState().pending).toEqual([])
  })

  it('a failed answer keeps the request and rejects', async () => {
    fakeBackend({
      'GET /api/permissions/pending': () => json([PENDING]),
      'POST /api/permissions/pending/req-1': () => json({ detail: 'boom' }, 500),
    })
    await usePermissionsStore.getState().refreshPending()

    await expect(usePermissionsStore.getState().decide('req-1', true, false)).rejects.toThrow()
    expect(usePermissionsStore.getState().pending).toHaveLength(1)
    expect(usePermissionsStore.getState().answering).toEqual({})
  })

  it('remembering re-reads the remembered list', async () => {
    const fetchMock = fakeBackend({
      'POST /api/permissions/pending/req-1': () => json(null, 204),
      'GET /api/permissions/remembered': () => json([REMEMBERED]),
    })
    await usePermissionsStore.getState().decide('req-1', true, true)
    await vi.waitFor(() => expect(usePermissionsStore.getState().remembered).toHaveLength(1))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')?.[1]?.body))
    expect(body).toEqual({ allow: true, remember: true })
  })

  it('revoking removes the decision; one already gone is not an error', async () => {
    fakeBackend({
      'GET /api/permissions/remembered': () => json([REMEMBERED]),
      'DELETE /api/permissions/remembered/d-1': () => json({ detail: 'Not Found' }, 404),
    })
    await usePermissionsStore.getState().loadRemembered()
    await usePermissionsStore.getState().revoke('d-1')
    expect(usePermissionsStore.getState().remembered).toEqual([])
  })
})
