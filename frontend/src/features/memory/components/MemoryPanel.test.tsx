import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { useMemoryStore } from '../memory-store'

import MemoryButton from './MemoryButton'
import MemoryPanel from './MemoryPanel'

type Memory = Record<string, unknown>

function memory(fields: Memory): Memory {
  return {
    topic: null,
    status: 'pending',
    proposedBy: 'Codex',
    sourceNodeId: 'n-1',
    sourceTitle: 'Folds',
    createdAt: '2026-10-02T10:00:00Z',
    decidedAt: null,
    revises: null,
    history: [],
    ...fields,
  }
}

const PROPOSAL = memory({ id: 'p-1', text: 'Knows foldr is right-associative' })
const REVISION = memory({
  id: 'p-2',
  text: 'Understands thunks and deferred evaluation',
  topic: 'haskell-laziness',
  proposedBy: 'Claude',
  sourceTitle: 'Laziness',
  revises: { id: 'a-1', text: 'Knows Haskell is lazy' },
})
const ACCEPTED = memory({
  id: 'a-1',
  text: 'Knows Haskell is lazy',
  topic: 'haskell-laziness',
  status: 'accepted',
  sourceTitle: 'Intro',
  decidedAt: '2026-10-01T11:00:00Z',
  history: [{ text: 'Has heard of laziness', decidedAt: '2026-09-30T10:00:00Z' }],
})

type Request = { method: string; url: string; body: unknown }

/** A fake of the memory routes that keeps what they did, answering lists from `state`. */
function fakeMemoryBackend(initial: { pending: Memory[]; accepted: Memory[] }) {
  const state = { ...initial }
  const requests: Request[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ method, url, body })
    if (url === '/api/memory' && method === 'GET') {
      return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url === '/api/memory/export') {
      return new Response('# Memory\n', { status: 200, headers: { 'Content-Type': 'text/markdown' } })
    }
    const match = /^\/api\/memory\/([^/]+)(?:\/(accept|reject))?$/.exec(url)
    if (match) {
      const [, id, action] = match
      state.pending = state.pending.filter((m) => m.id !== id)
      if (method === 'DELETE') state.accepted = state.accepted.filter((m) => m.id !== id)
      if (action === 'accept') {
        state.accepted = [...state.accepted, memory({ id, text: body?.text ?? 'accepted', status: 'accepted' })]
      }
      return new Response(null, { status: 204 })
    }
    return new Response('{"detail":"Not Found"}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, state }
}

function mutations(requests: Request[]) {
  return requests.filter((r) => r.method !== 'GET').map((r) => [r.method, r.url, r.body])
}

async function openPanel() {
  render(
    <>
      <MemoryButton />
      <MemoryPanel />
    </>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
  return screen.findByRole('dialog', { name: 'Memory' })
}

beforeEach(() => {
  useMemoryStore.getState().discard()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MemoryPanel — reaching it', () => {
  it('opens from the header button, loads, and closes', async () => {
    fakeMemoryBackend({ pending: [], accepted: [] })
    const dialog = await openPanel()

    expect(await within(dialog).findByText(/No proposals waiting/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Nothing remembered yet/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says why the memory could not be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))))
    const dialog = await openPanel()

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not load memory')
  })
})

describe('MemoryPanel — pending proposals', () => {
  it('shows each proposal with its text, topic, agent and source session', async () => {
    fakeMemoryBackend({ pending: [PROPOSAL], accepted: [] })
    const dialog = await openPanel()

    const proposal = await within(dialog).findByRole('article', { name: 'Knows foldr is right-associative' })
    expect(proposal).toHaveTextContent('Proposed by Codex')
    expect(proposal).toHaveTextContent('Folds')
  })

  it('shows a revision beside the accepted text it would replace', async () => {
    fakeMemoryBackend({ pending: [REVISION], accepted: [ACCEPTED] })
    const dialog = await openPanel()

    const revision = await within(dialog).findByRole('article', {
      name: 'Understands thunks and deferred evaluation',
    })
    expect(within(revision).getByTestId('memory-current')).toHaveTextContent('Knows Haskell is lazy')
    expect(within(revision).getByTestId('memory-proposed')).toHaveTextContent(
      'Understands thunks and deferred evaluation',
    )
    expect(revision).toHaveTextContent('haskell-laziness')
  })

  it('accepts a proposal as proposed', async () => {
    const { requests } = fakeMemoryBackend({ pending: [PROPOSAL], accepted: [] })
    const dialog = await openPanel()
    const proposal = await within(dialog).findByRole('article', { name: 'Knows foldr is right-associative' })

    fireEvent.click(within(proposal).getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(mutations(requests)).toEqual([['POST', '/api/memory/p-1/accept', {}]]))
    await waitFor(() =>
      expect(within(dialog).queryByRole('article', { name: 'Knows foldr is right-associative' })).toBeNull(),
    )
  })

  it('accepts a proposal with the learner’s edit', async () => {
    const { requests } = fakeMemoryBackend({ pending: [PROPOSAL], accepted: [] })
    const dialog = await openPanel()
    const proposal = await within(dialog).findByRole('article', { name: 'Knows foldr is right-associative' })

    fireEvent.click(within(proposal).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(proposal).getByRole('textbox', { name: 'Memory text' }), {
      target: { value: 'Knows foldr folds from the right' },
    })
    fireEvent.click(within(proposal).getByRole('button', { name: 'Accept edited' }))

    await waitFor(() =>
      expect(mutations(requests)).toEqual([
        ['POST', '/api/memory/p-1/accept', { text: 'Knows foldr folds from the right' }],
      ]),
    )
  })

  it('rejects a proposal', async () => {
    const { requests } = fakeMemoryBackend({ pending: [PROPOSAL], accepted: [] })
    const dialog = await openPanel()
    const proposal = await within(dialog).findByRole('article', { name: 'Knows foldr is right-associative' })

    fireEvent.click(within(proposal).getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(mutations(requests)).toEqual([['POST', '/api/memory/p-1/reject', {}]]))
  })
})

describe('MemoryPanel — accepted memories', () => {
  it('shows text, topic, agent, source and a history of superseded texts', async () => {
    fakeMemoryBackend({ pending: [], accepted: [ACCEPTED] })
    const dialog = await openPanel()

    const entry = await within(dialog).findByRole('article', { name: 'Knows Haskell is lazy' })
    expect(entry).toHaveTextContent('haskell-laziness')
    expect(entry).toHaveTextContent('Proposed by Codex')
    expect(entry).toHaveTextContent('Intro')
    expect(within(entry).getByText('Earlier versions (1)')).toBeInTheDocument()
    expect(within(entry).getByText('Has heard of laziness')).toBeInTheDocument()
  })

  it('edits an accepted memory', async () => {
    const { requests } = fakeMemoryBackend({ pending: [], accepted: [ACCEPTED] })
    const dialog = await openPanel()
    const entry = await within(dialog).findByRole('article', { name: 'Knows Haskell is lazy' })

    fireEvent.click(within(entry).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(entry).getByRole('textbox', { name: 'Memory text' }), {
      target: { value: 'Knows Haskell is non-strict' },
    })
    fireEvent.click(within(entry).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mutations(requests)).toEqual([['PUT', '/api/memory/a-1', { text: 'Knows Haskell is non-strict' }]]),
    )
  })

  it('removes an accepted memory only after a confirmation step', async () => {
    const { requests } = fakeMemoryBackend({ pending: [], accepted: [ACCEPTED] })
    const dialog = await openPanel()
    const entry = await within(dialog).findByRole('article', { name: 'Knows Haskell is lazy' })

    fireEvent.click(within(entry).getByRole('button', { name: 'Remove' }))
    expect(mutations(requests)).toEqual([])
    expect(entry).toHaveTextContent('no agent will receive it')

    fireEvent.click(within(entry).getByRole('button', { name: 'Keep it' }))
    expect(mutations(requests)).toEqual([])

    fireEvent.click(within(entry).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(entry).getByRole('button', { name: 'Remove for good' }))

    await waitFor(() => expect(mutations(requests)).toEqual([['DELETE', '/api/memory/a-1', undefined]]))
    await waitFor(() => expect(within(dialog).queryByRole('article', { name: 'Knows Haskell is lazy' })).toBeNull())
  })

  it('exports accepted memory as Markdown', async () => {
    const { requests } = fakeMemoryBackend({ pending: [], accepted: [ACCEPTED] })
    const dialog = await openPanel()
    await within(dialog).findByRole('article', { name: 'Knows Haskell is lazy' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Export as Markdown' }))

    await waitFor(() => expect(requests.some((r) => r.url === '/api/memory/export')).toBe(true))
  })

  it('shows a decision the backend refused in place, changing nothing', async () => {
    fakeMemoryBackend({ pending: [PROPOSAL], accepted: [] })
    const dialog = await openPanel()
    const proposal = await within(dialog).findByRole('article', { name: 'Knows foldr is right-associative' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))))

    fireEvent.click(within(proposal).getByRole('button', { name: 'Accept' }))

    expect(await within(proposal).findByRole('alert')).toHaveTextContent('could not be saved')
  })
})

describe('memory state on account change', () => {
  it('discarding forgets everything the panel held', async () => {
    fakeMemoryBackend({ pending: [PROPOSAL], accepted: [ACCEPTED] })
    await useMemoryStore.getState().load()

    useMemoryStore.getState().discard()

    expect(useMemoryStore.getState()).toMatchObject({ pending: [], accepted: [], status: 'idle', panelOpen: false })
  })
})
