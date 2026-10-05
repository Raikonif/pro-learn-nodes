import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { usePermissionsStore } from '../permissions-store'

import RememberedPermissions from './RememberedPermissions'

const EDITS = {
  id: 'd-1',
  nodeId: 'n-1',
  nodeTitle: 'Haskell',
  agentId: 'agent-codex',
  agentName: 'Codex',
  kind: 'edit',
  allow: true,
  createdAt: '2026-10-04T10:00:00Z',
}

const COMMANDS = { ...EDITS, id: 'd-2', nodeTitle: 'Monads', agentName: 'Claude', kind: 'execute', allow: false }

function json(body: unknown, status = 200): Response {
  return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status })
}

function fakeBackend(remembered: unknown[], revokeStatus = 204) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/permissions/remembered') return Promise.resolve(json(remembered))
    if (url.startsWith('/api/permissions/remembered/') && init?.method === 'DELETE') {
      return Promise.resolve(json(revokeStatus === 204 ? null : { detail: 'boom' }, revokeStatus))
    }
    return Promise.resolve(json({ detail: 'Not Found' }, 404))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => usePermissionsStore.getState().reset())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RememberedPermissions', () => {
  it('lists each decision by kind of action, node and agent', async () => {
    fakeBackend([EDITS, COMMANDS])
    render(<RememberedPermissions />)

    expect(await screen.findByRole('listitem', { name: 'Always allow edits in this node — Haskell on Codex' })).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', { name: 'Always refuse running commands in this node — Monads on Claude' }),
    ).toBeInTheDocument()
  })

  it('revoking removes it', async () => {
    const fetchMock = fakeBackend([EDITS])
    render(<RememberedPermissions />)

    const row = await screen.findByRole('listitem', { name: /Haskell on Codex/ })
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull())
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/permissions/remembered/d-1' && init?.method === 'DELETE')).toBe(true)
    expect(screen.getByText(/None\./)).toBeInTheDocument()
  })

  it('a revoke that fails keeps the decision and says so', async () => {
    fakeBackend([EDITS], 500)
    render(<RememberedPermissions />)

    const row = await screen.findByRole('listitem', { name: /Haskell on Codex/ })
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))

    expect(await within(row).findByText('Could not revoke. Try again.')).toBeInTheDocument()
  })

  it('says when nothing is remembered', async () => {
    fakeBackend([])
    render(<RememberedPermissions />)
    expect(await screen.findByText(/None\. When an agent asks/)).toBeInTheDocument()
  })
})
