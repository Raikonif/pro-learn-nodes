import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceStore } from './workspace-store'

const rootSnapshot = {
  schemaVersion: 1,
  workspaceId: 'workspace-1',
  revision: 3,
  graph: {
    nodes: [
      {
        id: 'node-1',
        title: 'Root',
        mode: 'Explore',
        body: '',
        activeSkills: [],
        mcpServers: [],
        createdAt: '2026-08-21T00:00:00.000Z',
        lastOpenedAt: '2026-08-21T00:00:00.000Z',
      },
    ],
    links: [],
    threads: [{ id: 'thread-1', nodeId: 'node-1', name: 'main', anchor: null }],
    messages: [],
  },
  context: { lastOpenNodeId: 'node-1', viewport: { x: 10, y: 20, zoom: 1 } },
}

const childSnapshot = {
  ...rootSnapshot,
  revision: 4,
  graph: {
    ...rootSnapshot.graph,
    nodes: [
      ...rootSnapshot.graph.nodes,
      {
        ...rootSnapshot.graph.nodes[0],
        id: 'node-2',
        title: 'New child of Root',
      },
    ],
    links: [{ id: 'link-1', parentId: 'node-1', childId: 'node-2', anchor: null }],
    threads: [
      ...rootSnapshot.graph.threads,
      { id: 'thread-2', nodeId: 'node-2', name: 'main', anchor: null },
    ],
  },
  context: { lastOpenNodeId: 'node-2', viewport: {} },
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function resetRuntimeStore(): void {
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

describe('workspace bootstrap', () => {
  beforeEach(() => {
    resetRuntimeStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetRuntimeStore()
  })

  it('hydrates only a validated backend snapshot and restores context', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(rootSnapshot)))

    await useWorkspaceStore.getState().hydrate()

    const state = useWorkspaceStore.getState()
    expect(state.status).toBe('ready')
    expect(state.workspaceId).toBe('workspace-1')
    expect(state.revision).toBe(3)
    expect(state.openNodeId).toBe('node-1')
    expect(state.openThreadId).toBe('thread-1')
    expect(state.viewport).toEqual({ x: 10, y: 20, zoom: 1 })
  })

  it('does not substitute fixtures after an invalid bootstrap response and can retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ ...rootSnapshot, schemaVersion: 99 }))
      .mockResolvedValueOnce(response(rootSnapshot))
    vi.stubGlobal('fetch', fetch)

    await useWorkspaceStore.getState().hydrate()
    expect(useWorkspaceStore.getState().status).toBe('error')
    expect(useWorkspaceStore.getState().graph.nodes).toEqual([])

    await useWorkspaceStore.getState().hydrate()
    expect(useWorkspaceStore.getState().status).toBe('ready')
    expect(useWorkspaceStore.getState().graph.nodes).toHaveLength(1)
  })

  it('applies a durable child-node result only after the backend response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(rootSnapshot))
      .mockResolvedValueOnce(response(childSnapshot))
    vi.stubGlobal('fetch', fetch)
    await useWorkspaceStore.getState().hydrate()

    const created = await useWorkspaceStore.getState().createChildNodeFrom('node-1')

    expect(created).toBe('node-2')
    expect(useWorkspaceStore.getState().graph.nodes.map((node) => node.id)).toEqual([
      'node-1',
      'node-2',
    ])
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/workspace/nodes/child',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('re-reads the snapshot after a turn settles without moving the open thread', async () => {
    const withSideThread = {
      ...rootSnapshot,
      graph: {
        ...rootSnapshot.graph,
        threads: [
          ...rootSnapshot.graph.threads,
          {
            id: 'thread-side',
            nodeId: 'node-1',
            name: 'side',
            anchor: { messageId: 'm-a', start: 0, end: 2, excerpt: 'Hi' },
          },
        ],
      },
    }
    const settled = {
      ...withSideThread,
      revision: 9,
      graph: {
        ...withSideThread.graph,
        messages: [
          {
            id: 'm-a',
            threadId: 'thread-side',
            role: 'agent',
            content: 'Hi there',
            createdAt: '2026-09-30T00:00:00.000Z',
            kind: 'message',
            outcome: 'completed',
          },
        ],
      },
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(withSideThread))
      .mockResolvedValueOnce(response(settled))
    vi.stubGlobal('fetch', fetch)
    await useWorkspaceStore.getState().hydrate()
    useWorkspaceStore.getState().openThread('thread-side')

    await useWorkspaceStore.getState().settleTurn([])

    const state = useWorkspaceStore.getState()
    expect(state.revision).toBe(9)
    expect(state.openThreadId).toBe('thread-side')
    expect(state.graph.messages.map((m) => m.content)).toEqual(['Hi there'])
    expect(fetch).toHaveBeenLastCalledWith('/api/workspace/bootstrap', { method: 'GET' })
  })

  it('defaults message kind, outcome and node backend for an older snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          ...rootSnapshot,
          graph: {
            ...rootSnapshot.graph,
            messages: [
              {
                id: 'm-old',
                threadId: 'thread-1',
                role: 'learner',
                content: 'Hello',
                createdAt: '2026-09-30T00:00:00.000Z',
              },
            ],
          },
        }),
      ),
    )

    await useWorkspaceStore.getState().hydrate()

    const { graph } = useWorkspaceStore.getState()
    expect(graph.nodes[0].backendAgentId).toBeNull()
    expect(graph.messages[0]).toMatchObject({ kind: 'message', outcome: null })
  })
})
