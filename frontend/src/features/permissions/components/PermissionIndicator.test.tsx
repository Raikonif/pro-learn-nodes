import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { usePermissionsStore } from '../permissions-store'

import PermissionIndicator, { PENDING_POLL_MS } from './PermissionIndicator'

function request(requestId: string, threadId: string, nodeTitle: string) {
  return {
    requestId,
    nodeId: `node-${requestId}`,
    threadId,
    nodeTitle,
    agentName: 'Codex',
    title: `Write ${requestId}.md`,
    kind: 'edit',
    locations: [],
    rememberable: true,
    agentRemembers: false,
  }
}

function json(body: unknown, status = 200): Response {
  return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status })
}

function fakeBackend(pending: () => unknown[]) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/permissions/pending') return Promise.resolve(json(pending()))
    if (/^\/api\/permissions\/pending\/./.test(url) && init?.method === 'POST') return Promise.resolve(json(null, 204))
    return Promise.resolve(json({ detail: 'Not Found' }, 404))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  usePermissionsStore.getState().reset()
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.setState({ openThreadId: 't-open' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('PermissionIndicator', () => {
  it('shows nothing while no request waits off screen', async () => {
    fakeBackend(() => [request('on-screen', 't-open', 'Open node')])
    render(<PermissionIndicator watching={false} />)
    await waitFor(() => expect(usePermissionsStore.getState().pending).toHaveLength(1))
    expect(screen.queryByTestId('permission-indicator')).toBeNull()
  })

  it('counts requests from conversations not on screen and answers them in place', async () => {
    const fetchMock = fakeBackend(() => [
      request('a', 't-other', 'Monads'),
      request('b', 't-third', 'Folds'),
      request('c', 't-open', 'Open node'),
    ])
    render(<PermissionIndicator watching={false} />)

    const indicator = await screen.findByTestId('permission-indicator')
    expect(indicator).toHaveTextContent('2 agents ask permission')

    fireEvent.click(indicator)
    const panel = screen.getByRole('dialog', { name: 'Waiting permission requests' })
    const cards = within(panel).getAllByTestId('permission-request')
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Monads · Codex'),
      expect.stringContaining('Folds · Codex'),
    ])

    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Refuse' }))
    await waitFor(() => expect(screen.getByTestId('permission-indicator')).toHaveTextContent('1 agent asks permission'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[0]).toBe('/api/permissions/pending/a')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ allow: false, remember: false })
  })

  it('opens the node a request came from', async () => {
    fakeBackend(() => [request('a', 't-other', 'Monads')])
    const openSessionAt = vi.fn(async () => {})
    useWorkspaceStore.setState({ openSessionAt })
    render(<PermissionIndicator watching={false} />)

    fireEvent.click(await screen.findByTestId('permission-indicator'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Monads →' }))
    expect(openSessionAt).toHaveBeenCalledWith('node-a', 't-other')
  })

  it('re-reads while a turn runs, and stops when nothing can be waiting', async () => {
    vi.useFakeTimers()
    const fetchMock = fakeBackend(() => [])
    const { rerender } = render(<PermissionIndicator watching />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS * 2)
    })
    const whileWatching = fetchMock.mock.calls.length
    expect(whileWatching).toBeGreaterThanOrEqual(3)

    rerender(<PermissionIndicator watching={false} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS * 3)
    })
    expect(fetchMock.mock.calls.length).toBe(whileWatching)
  })
})
