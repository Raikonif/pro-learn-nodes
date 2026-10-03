import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { useAccountStore, type Profile } from '../features/account'
import { useMemoryStore } from '../features/memory'
import { useAgentsStore } from '../features/settings'
import { useWorkspaceStore } from '../shared/lib/workspace-store'

import App from './App'

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
  email: 'bob@example.com',
  displayName: 'Bob',
  avatarUrl: null,
}

const AT = '2026-08-24T00:00:00.000Z'

function snapshot(owner: string, workspaceId: string) {
  return {
    schemaVersion: 1,
    workspaceId,
    revision: 1,
    graph: {
      nodes: [
        {
          id: `${owner}-node-1`,
          title: `${owner}: only node`,
          mode: 'Explore',
          body: '',
          activeSkills: [],
          mcpServers: [],
          createdAt: AT,
          lastOpenedAt: AT,
        },
      ],
      links: [],
      threads: [{ id: `${owner}-thread-1`, nodeId: `${owner}-node-1`, name: 'main', anchor: null }],
      messages: [
        {
          id: `${owner}-message-1`,
          threadId: `${owner}-thread-1`,
          role: 'learner',
          content: `${owner} private note`,
          createdAt: AT,
        },
      ],
    },
    context: { lastOpenNodeId: null, viewport: {} },
  }
}

const ALICE_WORKSPACE = snapshot('alice', 'workspace-alice')
const BOB_WORKSPACE = snapshot('bob', 'workspace-bob')

const PANES = ['left-rail', 'center-region', 'right-rail'] as const

function expectPanes(): void {
  for (const pane of PANES) expect(screen.getByTestId(pane)).toBeInTheDocument()
}

function expectNoPanes(): void {
  for (const pane of PANES) expect(screen.queryByTestId(pane)).toBeNull()
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Answers whichever `/api` call the render happens to make. The workspace
 * chrome probes `/health` on mount, so a test that only mocks its own route
 * would leave an unhandled rejection behind.
 */
function stubRoutes(routes: Record<string, () => Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      const handler = routes[path]
      return handler ? Promise.resolve(handler()) : new Promise<Response>(() => {})
    }),
  )
}

function signedIn(profile: Profile = LEARNER): void {
  useAccountStore.getState().applySession({ profile, mechanisms: ['local', 'dev'] })
}

/**
 * The state a freshly-launched window is in: no workspace, nothing hydrated.
 * The shared `beforeEach` installs the fixture graph instead, which no account
 * owns and which hydration would never produce.
 */
function unhydrated(): void {
  useWorkspaceStore.setState({
    graph: { nodes: [], links: [], threads: [], messages: [], projects: [], archivedLinks: [] },
    workspaceId: null,
    revision: null,
    viewport: {},
    status: 'loading',
    startupError: null,
    openNodeId: null,
    openThreadId: null,
    searchTerm: '',
  })
}

/** Answers each bootstrap request with the next snapshot in the queue. */
function stubBootstraps(snapshots: unknown[]): void {
  const queue = [...snapshots]
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      if (path === '/api/workspace/bootstrap') {
        const next = queue.shift()
        return next === undefined
          ? new Promise<Response>(() => {})
          : Promise.resolve(jsonResponse(next))
      }
      if (path === '/api/auth/signout') return Promise.resolve(jsonResponse({ ok: true }))
      return new Promise<Response>(() => {})
    }),
  )
}

function graphOwners(): string {
  return JSON.stringify(useWorkspaceStore.getState().graph)
}

function signedOut(): void {
  useAccountStore.getState().applySession({ profile: null, mechanisms: ['local', 'dev'] })
}

beforeEach(() => {
  // A never-settling fetch keeps the chrome's health probe in its initial
  // state — the suite must not depend on a backend.
  stubRoutes({})
  useWorkspaceStore.getState().reset()
  useAccountStore.getState().reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App root view', () => {
  it('waits for the session instead of flashing the sign-in surface', () => {
    // `reset()` leaves the session unread and the stubbed fetch never settles,
    // so this is the state a returning learner is in for one paint.
    render(<App />)

    expect(screen.queryByTestId('sign-in-surface')).toBeNull()
    expectNoPanes()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders the sign-in surface and no workspace pane when signed out', () => {
    signedOut()
    render(<App />)

    expect(screen.getByTestId('sign-in-surface')).toBeInTheDocument()
    expectNoPanes()
  })

  it('renders the workspace as the root view while an account is active', () => {
    signedIn()
    render(<App />)

    expectPanes()
    expect(screen.queryByTestId('sign-in-surface')).toBeNull()
  })

  it('shows the Learn Nodes title in the chrome', () => {
    signedIn()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Learn Nodes' })).toBeInTheDocument()
  })

  it('reveals the three-pane workspace once sign-in completes', async () => {
    signedOut()
    stubRoutes({
      '/api/auth/dev/signin': () => jsonResponse(LEARNER),
      // Signing in discards whatever the window was holding, so the panes are
      // waiting on this response rather than on the fixture graph.
      '/api/workspace/bootstrap': () => jsonResponse(ALICE_WORKSPACE),
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /development sign-in/i }))

    await waitFor(() => expect(screen.getByTestId('left-rail')).toBeInTheDocument())
    expectPanes()
    expect(screen.queryByTestId('sign-in-surface')).toBeNull()
  })
})

describe('App account affordance', () => {
  it('shows the active display name while a node is open, keeping all three panes', () => {
    signedIn()
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<App />)

    expect(screen.getByTestId('account-identity')).toHaveTextContent('Alice')
    // The identity is chrome, not a fourth pane — the workspace still has
    // exactly the three it started with.
    expectPanes()
  })

  it('discards the previous account’s workspace when a different account signs in', async () => {
    unhydrated()
    stubBootstraps([ALICE_WORKSPACE, BOB_WORKSPACE])
    signedIn(LEARNER)
    render(<App />)

    await waitFor(() => expect(graphOwners()).toContain('alice private note'))

    act(() => signedIn(OTHER_LEARNER))

    await waitFor(() => expect(graphOwners()).toContain('bob private note'))
    // The material itself is gone, not outranked by Bob's copy of the graph.
    expect(graphOwners()).not.toContain('alice')
    expect(useWorkspaceStore.getState().workspaceId).toBe('workspace-bob')
  })

  it('discards the workspace on sign-out, not only on a switch', async () => {
    unhydrated()
    stubBootstraps([ALICE_WORKSPACE])
    signedIn(LEARNER)
    render(<App />)

    await waitFor(() => expect(graphOwners()).toContain('alice private note'))

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(screen.getByTestId('sign-in-surface')).toBeInTheDocument())
    // A signed-out window holds none of the account it just left.
    const state = useWorkspaceStore.getState()
    expect(state.graph).toEqual({ nodes: [], links: [], threads: [], messages: [], projects: [], archivedLinks: [] })
    expect(state.workspaceId).toBeNull()
  })

  it('forgets the previous account’s registered agents on a switch', async () => {
    unhydrated()
    stubBootstraps([ALICE_WORKSPACE, BOB_WORKSPACE])
    signedIn(LEARNER)
    render(<App />)
    await waitFor(() => expect(graphOwners()).toContain('alice private note'))
    act(() =>
      useAgentsStore.setState({
        status: 'ready',
        agents: [
          { id: 'a-1', name: 'Alice Codex', command: 'npx', args: [], env: {}, isDefault: true },
        ],
      }),
    )

    act(() => signedIn(OTHER_LEARNER))

    await waitFor(() => expect(useAgentsStore.getState().agents).toEqual([]))
  })

  it('forgets the previous account’s memory on a switch', async () => {
    unhydrated()
    stubBootstraps([ALICE_WORKSPACE, BOB_WORKSPACE])
    signedIn(LEARNER)
    render(<App />)
    await waitFor(() => expect(graphOwners()).toContain('alice private note'))
    act(() =>
      useMemoryStore.setState({
        status: 'ready',
        accepted: [
          {
            id: 'mem-1',
            text: 'Alice knows folds',
            topic: null,
            status: 'accepted',
            proposedBy: 'Codex',
            sourceNodeId: null,
            sourceTitle: null,
            createdAt: AT,
            decidedAt: AT,
            revises: null,
            history: [],
          },
        ],
      }),
    )

    act(() => signedIn(OTHER_LEARNER))

    await waitFor(() => expect(useMemoryStore.getState().accepted).toEqual([]))
  })

  it('returns to the sign-in surface after signing out', async () => {
    signedIn()
    stubRoutes({ '/api/auth/signout': () => jsonResponse({ ok: true }) })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(screen.getByTestId('sign-in-surface')).toBeInTheDocument())
    expectNoPanes()
  })
})
