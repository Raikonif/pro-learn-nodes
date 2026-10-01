import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  acceptMemory,
  editMemory,
  exportMemory,
  listMemory,
  rejectMemory,
  removeMemory,
} from './memory-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stub(body: unknown, status = 200, contentType = 'application/json') {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status,
            headers: { 'Content-Type': contentType },
          }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const PENDING = {
  id: 'mem-2',
  text: 'Understands thunks and deferred evaluation',
  topic: 'haskell-laziness',
  status: 'pending',
  proposedBy: 'Claude',
  sourceNodeId: 'n-1',
  sourceTitle: 'Laziness',
  createdAt: '2026-10-02T10:00:00Z',
  decidedAt: null,
  revises: { id: 'mem-1', text: 'Knows Haskell is lazy' },
  history: [],
}

const ACCEPTED = {
  id: 'mem-1',
  text: 'Knows Haskell is lazy',
  topic: 'haskell-laziness',
  status: 'accepted',
  proposedBy: 'Codex',
  sourceNodeId: null,
  sourceTitle: null,
  createdAt: '2026-10-01T10:00:00Z',
  decidedAt: '2026-10-01T11:00:00Z',
  revises: null,
  history: [{ text: 'Has heard of laziness', decidedAt: '2026-09-30T10:00:00Z' }],
}

describe('memory api', () => {
  it('lists pending proposals and accepted memories', async () => {
    const fetchMock = stub({ pending: [PENDING], accepted: [ACCEPTED] })

    await expect(listMemory()).resolves.toEqual({ pending: [PENDING], accepted: [ACCEPTED] })
    expect(fetchMock).toHaveBeenCalledWith('/api/memory', { method: 'GET' })
  })

  it('reads a memory without revision or history fields as having neither', async () => {
    const { revises: _r, history: _h, topic: _t, ...bare } = ACCEPTED
    stub({ pending: [], accepted: [bare] })

    const { accepted } = await listMemory()

    expect(accepted[0]).toMatchObject({ revises: null, history: [], topic: null })
  })

  it('accepts as proposed, or with the learner’s edit', async () => {
    const fetchMock = stub({})

    await acceptMemory('mem-2')
    await acceptMemory('mem-2', 'Understands thunks')

    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(init?.body as string)])
    expect(calls).toEqual([
      ['/api/memory/mem-2/accept', 'POST', {}],
      ['/api/memory/mem-2/accept', 'POST', { text: 'Understands thunks' }],
    ])
  })

  it('rejects, edits and removes by id', async () => {
    const fetchMock = stub(null, 204)

    await rejectMemory('mem-2')
    await editMemory('mem-1', 'Knows laziness well')
    await removeMemory('mem-1')

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/memory/mem-2/reject', 'POST', '{}'],
      ['/api/memory/mem-1', 'PUT', JSON.stringify({ text: 'Knows laziness well' })],
      ['/api/memory/mem-1', 'DELETE', undefined],
    ])
  })

  it('exports accepted memory as Markdown text', async () => {
    const fetchMock = stub('# Memory\n\n- Knows Haskell is lazy\n', 200, 'text/markdown')

    await expect(exportMemory()).resolves.toBe('# Memory\n\n- Knows Haskell is lazy\n')
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/export', { method: 'GET' })
  })
})
