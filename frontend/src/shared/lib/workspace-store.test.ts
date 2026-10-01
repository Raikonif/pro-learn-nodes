import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAnchor } from './anchor-resolver'
import { FIXTURE_GRAPH, messageById, parentsOf, threadsForNode } from './fixtures'
import { __resetIdCounter, selectRecents, useWorkspaceStore } from './workspace-store'

function anchorInHaskell() {
  const source = messageById(FIXTURE_GRAPH, 'm-hs-2')!
  const start = source.content.indexOf('infinite lists')
  return createAnchor(source, start, start + 'infinite lists'.length)
}

describe('workspace store — opening and closing', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('starts with nothing open', () => {
    const { openNodeId, openThreadId } = useWorkspaceStore.getState()
    expect(openNodeId).toBeNull()
    expect(openThreadId).toBeNull()
  })

  it('opens a node on its main thread', () => {
    useWorkspaceStore.getState().openNode('n-haskell')

    const { openNodeId, openThreadId } = useWorkspaceStore.getState()
    expect(openNodeId).toBe('n-haskell')
    expect(openThreadId).toBe('t-haskell-main')
  })

  it('opens on the main thread even after a spawned thread was showing', () => {
    const store = useWorkspaceStore.getState()
    store.openNode('n-haskell')
    store.openThread('t-haskell-thunks')
    expect(useWorkspaceStore.getState().openThreadId).toBe('t-haskell-thunks')

    // Switching nodes must not carry the previous node's thread selection.
    useWorkspaceStore.getState().openNode('n-functors')
    expect(useWorkspaceStore.getState().openThreadId).toBe('t-functors-main')
  })

  it('closing a node clears both the node and the thread', () => {
    const store = useWorkspaceStore.getState()
    store.openNode('n-haskell')
    store.openThread('t-haskell-thunks')

    useWorkspaceStore.getState().closeNode()

    const { openNodeId, openThreadId } = useWorkspaceStore.getState()
    expect(openNodeId).toBeNull()
    expect(openThreadId).toBeNull()
  })

  it('opening a thread leaves the open node unchanged', () => {
    const store = useWorkspaceStore.getState()
    store.openNode('n-haskell')

    useWorkspaceStore.getState().openThread('t-haskell-once')

    const { openNodeId, openThreadId } = useWorkspaceStore.getState()
    expect(openNodeId).toBe('n-haskell')
    expect(openThreadId).toBe('t-haskell-once')
  })
})

describe('workspace store — recents', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('orders nodes most recently opened first', () => {
    const titles = selectRecents(useWorkspaceStore.getState()).map((n) => n.title)
    expect(titles).toEqual([
      'Functors',
      'Haskell',
      'Category Theory',
      'Lazy Evaluation',
      'Functional Programming',
    ])
  })

  it('moves a node to the front when it is opened', () => {
    useWorkspaceStore.getState().openNode('n-fp')

    const titles = selectRecents(useWorkspaceStore.getState()).map((n) => n.title)
    expect(titles[0]).toBe('Functional Programming')
  })

  it('does not narrow the list by the search term — search is the backend index', () => {
    // Content search needs the message index, so the rail queries the backend
    // for matches; the recency list itself stays whole.
    useWorkspaceStore.getState().setSearchTerm('func')

    expect(useWorkspaceStore.getState().searchTerm).toBe('func')
    expect(selectRecents(useWorkspaceStore.getState())).toHaveLength(FIXTURE_GRAPH.nodes.length)
  })

  it('orders by last activity rather than last opening', () => {
    useWorkspaceStore.setState((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) =>
          n.id === 'n-lazy-evaluation' ? { ...n, lastActivityAt: '2026-09-01T00:00:00.000Z' } : n,
        ),
      },
    }))

    expect(selectRecents(useWorkspaceStore.getState())[0].id).toBe('n-lazy-evaluation')
  })

  it('lists only nodes, never threads', () => {
    const ids = selectRecents(useWorkspaceStore.getState()).map((n) => n.id)
    const threadIds = FIXTURE_GRAPH.threads.map((t) => t.id)

    expect(ids.some((id) => threadIds.includes(id))).toBe(false)
    expect(ids).toHaveLength(FIXTURE_GRAPH.nodes.length)
  })
})

describe('workspace fixture graph', () => {
  it('contains multiple node branches and keeps side threads off the graph', () => {
    expect(FIXTURE_GRAPH.nodes.length).toBeGreaterThanOrEqual(5)

    const branchPoints = FIXTURE_GRAPH.nodes.filter(
      (node) => FIXTURE_GRAPH.links.filter((link) => link.parentId === node.id).length > 1,
    )
    expect(branchPoints.length).toBeGreaterThanOrEqual(2)

    const sideThreads = FIXTURE_GRAPH.threads.filter((thread) => thread.anchor !== null)
    expect(sideThreads.length).toBeGreaterThanOrEqual(2)
    expect(sideThreads.every((thread) => !FIXTURE_GRAPH.nodes.some((node) => node.id === thread.id))).toBe(
      true,
    )
    expect(parentsOf(FIXTURE_GRAPH, 'n-functors')).toEqual(['n-haskell', 'n-cat'])
  })
})

describe('workspace store — generating a node', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('adds a node and an edge carrying the anchor', () => {
    const anchor = anchorInHaskell()
    const before = useWorkspaceStore.getState().graph

    const newId = useWorkspaceStore.getState().generateNodeFrom('n-haskell', anchor)
    const after = useWorkspaceStore.getState().graph

    expect(after.nodes).toHaveLength(before.nodes.length + 1)
    expect(after.links).toHaveLength(before.links.length + 1)

    const link = after.links.find((l) => l.childId === newId)
    expect(link?.parentId).toBe('n-haskell')
    expect(link?.anchor).toEqual(anchor)
  })

  it('inherits mode, skills, and MCP servers from the source node', () => {
    const newId = useWorkspaceStore.getState().generateNodeFrom('n-haskell', anchorInHaskell())

    const created = useWorkspaceStore.getState().graph.nodes.find((n) => n.id === newId)!
    expect(created.mode).toBe('Deepen')
    expect(created.activeSkills).toEqual(['study-coach', 'code-explainer'])
    expect(created.mcpServers).toEqual(['filesystem'])
  })

  it('applies overrides when the learner supplies them', () => {
    const newId = useWorkspaceStore
      .getState()
      .generateNodeFrom('n-haskell', anchorInHaskell(), {
        title: 'Infinite structures',
        mode: 'Quiz',
      })

    const created = useWorkspaceStore.getState().graph.nodes.find((n) => n.id === newId)!
    expect(created.title).toBe('Infinite structures')
    expect(created.mode).toBe('Quiz')
    // Unspecified fields still inherit.
    expect(created.mcpServers).toEqual(['filesystem'])
  })

  it('gives the new node its own main thread', () => {
    const newId = useWorkspaceStore.getState().generateNodeFrom('n-haskell', anchorInHaskell())

    const threads = threadsForNode(useWorkspaceStore.getState().graph, newId as string)
    expect(threads).toHaveLength(1)
    expect(threads[0].anchor).toBeNull()
  })

  it('links to the owning node when branching from a nested thread', () => {
    // The selection lives in `t-haskell-once`, two levels deep. The new node
    // must attach to `n-haskell`, the node that owns the thread.
    const source = messageById(FIXTURE_GRAPH, 'm-on-2')!
    const anchor = createAnchor(source, 4, 11)

    const newId = useWorkspaceStore.getState().generateNodeFrom('n-haskell', anchor)

    const link = useWorkspaceStore.getState().graph.links.find((l) => l.childId === newId)
    expect(link?.parentId).toBe('n-haskell')
  })

  it('refuses to branch from an unknown node', () => {
    expect(() =>
      useWorkspaceStore.getState().generateNodeFrom('n-nope', anchorInHaskell()),
    ).toThrow(/unknown node/)
  })
})

describe('workspace store — creating a whole-node child', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('creates an unanchored child with an inherited configuration and opens its main thread', () => {
    const parent = useWorkspaceStore
      .getState()
      .graph.nodes.find((node) => node.id === 'n-haskell')!
    const before = useWorkspaceStore.getState().graph

    const childId = useWorkspaceStore.getState().createChildNodeFrom(parent.id)
    const { graph, openNodeId, openThreadId } = useWorkspaceStore.getState()
    const child = graph.nodes.find((node) => node.id === (childId as string))!
    const link = graph.links.find((candidate) => candidate.childId === (childId as string))!
    const childThreads = threadsForNode(graph, childId as string)

    expect(graph.nodes).toHaveLength(before.nodes.length + 1)
    expect(graph.links).toHaveLength(before.links.length + 1)
    expect(link.parentId).toBe(parent.id)
    expect(link.anchor).toBeNull()
    expect(child.mode).toBe(parent.mode)
    expect(child.activeSkills).toEqual(parent.activeSkills)
    expect(child.activeSkills).not.toBe(parent.activeSkills)
    expect(child.mcpServers).toEqual(parent.mcpServers)
    expect(child.mcpServers).not.toBe(parent.mcpServers)
    expect(childThreads).toHaveLength(1)
    expect(childThreads[0].name).toBe('main')
    expect(childThreads[0].anchor).toBeNull()
    expect(openNodeId).toBe(childId)
    expect(openThreadId).toBe(childThreads[0].id)
  })

  it('refuses to create a child from an unknown node', () => {
    expect(() => useWorkspaceStore.getState().createChildNodeFrom('n-nope')).toThrow(
      /unknown node/,
    )
  })
})

const AT = '2026-08-24T00:00:00.000Z'

function node(id: string, title: string) {
  return {
    id,
    title,
    mode: 'Explore',
    body: '',
    activeSkills: [],
    mcpServers: [],
    createdAt: AT,
    lastOpenedAt: AT,
  }
}

const ALICE_SNAPSHOT = {
  schemaVersion: 1,
  workspaceId: 'workspace-alice',
  revision: 7,
  graph: {
    nodes: [node('alice-node-1', 'Alice: Monads'), node('alice-node-2', 'Alice: Kleisli')],
    links: [{ id: 'alice-link-1', parentId: 'alice-node-1', childId: 'alice-node-2', anchor: null }],
    threads: [{ id: 'alice-thread-1', nodeId: 'alice-node-1', name: 'alice-main', anchor: null }],
    messages: [
      {
        id: 'alice-message-1',
        threadId: 'alice-thread-1',
        role: 'learner',
        content: 'Alice private note',
        createdAt: AT,
      },
    ],
  },
  context: { lastOpenNodeId: 'alice-node-1', viewport: { x: 42 } },
}

const BOB_SNAPSHOT = {
  schemaVersion: 1,
  workspaceId: 'workspace-bob',
  revision: 2,
  graph: {
    nodes: [node('bob-node-1', 'Bob: Ownership')],
    links: [],
    threads: [{ id: 'bob-thread-1', nodeId: 'bob-node-1', name: 'main', anchor: null }],
    messages: [],
  },
  context: { lastOpenNodeId: 'bob-node-1', viewport: {} },
}

const BOB_AFTER_CHILD = {
  ...BOB_SNAPSHOT,
  revision: 3,
  graph: {
    ...BOB_SNAPSHOT.graph,
    nodes: [...BOB_SNAPSHOT.graph.nodes, node('bob-node-2', 'Bob: Borrowing')],
    links: [{ id: 'bob-link-1', parentId: 'bob-node-1', childId: 'bob-node-2', anchor: null }],
  },
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

async function hydrateFrom(snapshot: unknown): Promise<void> {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(snapshot))))
  await useWorkspaceStore.getState().hydrate()
}

describe('workspace store — discarding hydrated state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves nothing of the previous account behind', async () => {
    await hydrateFrom(ALICE_SNAPSHOT)
    expect(useWorkspaceStore.getState().graph.nodes).toHaveLength(2)

    useWorkspaceStore.getState().discardHydratedState()

    const state = useWorkspaceStore.getState()
    expect(state.graph).toEqual({ nodes: [], links: [], threads: [], messages: [] })
    expect(state.workspaceId).toBeNull()
    expect(state.revision).toBeNull()
    expect(state.status).toBe('loading')
    // Gone, not shadowed: nothing that was Alice's survives anywhere in the
    // store — not in the graph, not in the restored viewport, not in the id.
    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain('Alice')
    expect(serialized).not.toContain('alice')
    expect(serialized).not.toContain('42')
  })

  it('refuses workspace mutations until the next account has hydrated', async () => {
    await hydrateFrom(ALICE_SNAPSHOT)
    useWorkspaceStore.getState().discardHydratedState()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(BOB_SNAPSHOT))
      .mockResolvedValueOnce(response(BOB_AFTER_CHILD))
    vi.stubGlobal('fetch', fetchMock)

    const attempt = async (): Promise<string> =>
      useWorkspaceStore.getState().createChildNodeFrom('alice-node-1')
    await expect(attempt()).rejects.toThrow(/not hydrated/)
    expect(fetchMock).not.toHaveBeenCalled()

    await useWorkspaceStore.getState().hydrate()
    await useWorkspaceStore.getState().createChildNodeFrom('bob-node-1')

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/workspace/nodes/child',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('cancels a pending viewport save so it cannot land in the next account', async () => {
    vi.useFakeTimers()
    try {
      await hydrateFrom(ALICE_SNAPSHOT)
      const fetchMock = vi.fn(() => Promise.resolve(response(ALICE_SNAPSHOT)))
      vi.stubGlobal('fetch', fetchMock)

      useWorkspaceStore.getState().setViewport({ x: 99 })
      useWorkspaceStore.getState().discardHydratedState()
      vi.runAllTimers()

      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('workspace store — creating a thread', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('adds a thread on the current node carrying the anchor', () => {
    const anchor = anchorInHaskell()

    const threadId = useWorkspaceStore.getState().createThreadFrom('n-haskell', anchor)

    const thread = useWorkspaceStore
      .getState()
      .graph.threads.find((t) => t.id === threadId)!
    expect(thread.nodeId).toBe('n-haskell')
    expect(thread.anchor).toEqual(anchor)
  })

  it('leaves the graph untouched — no node, no edge', () => {
    const before = useWorkspaceStore.getState().graph

    useWorkspaceStore.getState().createThreadFrom('n-haskell', anchorInHaskell())
    const after = useWorkspaceStore.getState().graph

    expect(after.nodes).toEqual(before.nodes)
    expect(after.links).toEqual(before.links)
  })

  it('keeps a thread spawned from a thread on the same node', () => {
    const source = messageById(FIXTURE_GRAPH, 'm-on-2')!
    const anchor = createAnchor(source, 4, 11)

    const threadId = useWorkspaceStore.getState().createThreadFrom('n-haskell', anchor)

    const thread = useWorkspaceStore
      .getState()
      .graph.threads.find((t) => t.id === threadId)!
    expect(thread.nodeId).toBe('n-haskell')
  })

  it('names the thread from the branched text when no name is given', () => {
    const threadId = useWorkspaceStore.getState().createThreadFrom('n-haskell', anchorInHaskell())

    const thread = useWorkspaceStore
      .getState()
      .graph.threads.find((t) => t.id === threadId)!
    expect(thread.name).toBe('infinite lists')
  })

  it('refuses to create a thread on an unknown node', () => {
    expect(() =>
      useWorkspaceStore.getState().createThreadFrom('n-nope', anchorInHaskell()),
    ).toThrow(/unknown node/)
  })
})

describe('workspace store — conversation backend', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('records a backend change on the node', () => {
    useWorkspaceStore.getState().setNodeBackend('n-haskell', 'agent-1')

    const node = useWorkspaceStore.getState().graph.nodes.find((n) => n.id === 'n-haskell')!
    expect(node.backendAgentId).toBe('agent-1')
  })

  it('gives a whole-node child its parent backend', () => {
    useWorkspaceStore.getState().setNodeBackend('n-haskell', 'agent-1')

    const childId = useWorkspaceStore.getState().createChildNodeFrom('n-haskell') as string

    const child = useWorkspaceStore.getState().graph.nodes.find((n) => n.id === childId)!
    expect(child.backendAgentId).toBe('agent-1')
  })

  it('gives a branched node its source backend', () => {
    useWorkspaceStore.getState().setNodeBackend('n-haskell', 'agent-1')

    const nodeId = useWorkspaceStore.getState().generateNodeFrom('n-haskell', anchorInHaskell()) as string

    const node = useWorkspaceStore.getState().graph.nodes.find((n) => n.id === nodeId)!
    expect(node.backendAgentId).toBe('agent-1')
  })
})

describe('workspace store — settling a streamed turn', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('upserts turn messages by id so a recorded message never appears twice', () => {
    const base = {
      threadId: 't-haskell-main',
      createdAt: '2026-09-30T00:00:00.000Z',
      kind: 'message' as const,
    }
    const before = useWorkspaceStore.getState().graph.messages.length

    useWorkspaceStore.getState().settleTurn([
      { ...base, id: 'm-live-1', role: 'learner', content: 'Why?', outcome: null },
      { ...base, id: 'm-live-2', role: 'agent', content: 'Part', outcome: 'incomplete' },
    ])
    useWorkspaceStore.getState().settleTurn([
      { ...base, id: 'm-live-2', role: 'agent', content: 'Partial answer', outcome: 'cancelled' },
    ])

    const messages = useWorkspaceStore.getState().graph.messages
    expect(messages).toHaveLength(before + 2)
    expect(messages.find((m) => m.id === 'm-live-2')).toMatchObject({
      content: 'Partial answer',
      outcome: 'cancelled',
    })
  })
})

describe('workspace store — root sessions (fixture)', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('creates a provisional root session, opens it, and asks for composer focus', () => {
    const before = useWorkspaceStore.getState().graph

    const nodeId = useWorkspaceStore.getState().createRootNode() as string

    const { graph, openNodeId, openThreadId, composerFocusRequested } = useWorkspaceStore.getState()
    const node = graph.nodes.find((n) => n.id === nodeId)!
    expect(graph.nodes).toHaveLength(before.nodes.length + 1)
    // A root: nothing links to it.
    expect(graph.links).toEqual(before.links)
    expect(node).toMatchObject({ title: 'New session', titleSource: 'provisional', mode: 'Explore' })
    expect(openNodeId).toBe(nodeId)
    expect(openThreadId).toBe(threadsForNode(graph, nodeId)[0].id)
    expect(composerFocusRequested).toBe(true)
  })

  it('titles a detailed start with its topic and mode', () => {
    const nodeId = useWorkspaceStore
      .getState()
      .createRootNode({ title: '  Monads ', mode: 'Quiz' }) as string

    const node = useWorkspaceStore.getState().graph.nodes.find((n) => n.id === nodeId)!
    expect(node).toMatchObject({ title: 'Monads', titleSource: 'topic', mode: 'Quiz' })
  })

  it('consumes the composer focus request once', () => {
    useWorkspaceStore.getState().createRootNode()
    useWorkspaceStore.getState().consumeComposerFocus()
    expect(useWorkspaceStore.getState().composerFocusRequested).toBe(false)
  })
})

describe('workspace store — renaming, archiving, restoring (fixture)', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  function nodeTitle(id: string) {
    return useWorkspaceStore.getState().graph.nodes.find((n) => n.id === id)?.title
  }

  it('renames a node with a learner title', () => {
    useWorkspaceStore.getState().renameNode('n-haskell', '  Laziness in Haskell ')

    const node = useWorkspaceStore.getState().graph.nodes.find((n) => n.id === 'n-haskell')!
    expect(node.title).toBe('Laziness in Haskell')
    expect(node.titleSource).toBe('learner')
  })

  it('refuses an empty title and keeps the old one', () => {
    expect(() => useWorkspaceStore.getState().renameNode('n-haskell', '   ')).toThrow(/empty/)
    expect(nodeTitle('n-haskell')).toBe('Haskell')
  })

  it('archives a node: it and its links leave, its children stay', () => {
    useWorkspaceStore.getState().archiveNode('n-haskell')

    const { graph } = useWorkspaceStore.getState()
    expect(graph.nodes.some((n) => n.id === 'n-haskell')).toBe(false)
    expect(graph.links.some((l) => l.parentId === 'n-haskell' || l.childId === 'n-haskell')).toBe(false)
    expect(graph.nodes.some((n) => n.id === 'n-functors')).toBe(true)
    expect(graph.nodes.some((n) => n.id === 'n-lazy-evaluation')).toBe(true)
    // Nothing of its conversation is deleted.
    expect(graph.messages.filter((m) => m.threadId === 't-haskell-main')).not.toHaveLength(0)
  })

  it('closes the node when the open node is archived', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    useWorkspaceStore.getState().archiveNode('n-haskell')

    expect(useWorkspaceStore.getState().openNodeId).toBeNull()
    expect(useWorkspaceStore.getState().openThreadId).toBeNull()
  })

  it('restores an archived node with its links', () => {
    const before = useWorkspaceStore.getState().graph
    useWorkspaceStore.getState().archiveNode('n-haskell')
    useWorkspaceStore.getState().restoreNode('n-haskell')

    const { graph } = useWorkspaceStore.getState()
    expect(graph.nodes).toHaveLength(before.nodes.length)
    expect([...graph.links].map((l) => l.id).sort()).toEqual(before.links.map((l) => l.id).sort())
  })
})

describe('workspace store — opening a session at a message (fixture)', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('opens the node on the named thread and asks for the message to be revealed', async () => {
    await useWorkspaceStore.getState().openSessionAt('n-haskell', 't-haskell-once', 'm-on-2')

    const state = useWorkspaceStore.getState()
    expect(state.openNodeId).toBe('n-haskell')
    expect(state.openThreadId).toBe('t-haskell-once')
    expect(state.revealedMessageId).toBe('m-on-2')

    state.clearRevealedMessage()
    expect(useWorkspaceStore.getState().revealedMessageId).toBeNull()
  })

  it('opens a title-only match on the main thread with nothing to reveal', async () => {
    await useWorkspaceStore.getState().openSessionAt('n-cat', null, null)

    const state = useWorkspaceStore.getState()
    expect(state.openThreadId).toBe('t-cat-main')
    expect(state.revealedMessageId).toBeNull()
  })

  it('ignores a thread that belongs to another node', async () => {
    await useWorkspaceStore.getState().openSessionAt('n-cat', 't-haskell-once', null)

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-cat-main')
  })
})

describe('workspace store — session routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const CAROL = {
    schemaVersion: 1,
    workspaceId: 'workspace-carol',
    revision: 1,
    graph: {
      nodes: [node('carol-node-1', 'Carol: Types')],
      links: [],
      threads: [{ id: 'carol-thread-1', nodeId: 'carol-node-1', name: 'main', anchor: null }],
      messages: [],
    },
    context: { lastOpenNodeId: null, viewport: {} },
  }

  const CAROL_CREATED = {
    ...CAROL,
    revision: 2,
    graph: {
      ...CAROL.graph,
      nodes: [
        ...CAROL.graph.nodes,
        {
          ...node('carol-node-2', 'New session'),
          createdAt: '2026-09-30T00:00:00.000Z',
          titleSource: 'provisional',
        },
      ],
      threads: [
        ...CAROL.graph.threads,
        { id: 'carol-thread-2', nodeId: 'carol-node-2', name: 'main', anchor: null },
      ],
    },
  }

  const CAROL_OPENED = {
    ...CAROL_CREATED,
    revision: 3,
    context: { lastOpenNodeId: 'carol-node-2', viewport: {} },
  }

  function queued(...bodies: unknown[]) {
    const fetchMock = vi.fn<typeof fetch>()
    for (const body of bodies) fetchMock.mockResolvedValueOnce(response(body))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('creates a root session, then opens it through the context route', async () => {
    await hydrateFrom(CAROL)
    const fetchMock = queued(CAROL_CREATED, CAROL_OPENED)

    const nodeId = await useWorkspaceStore.getState().createRootNode()

    expect(nodeId).toBe('carol-node-2')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspace/nodes')
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({}))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/workspace/context')
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ lastOpenNodeId: 'carol-node-2', viewport: {} }),
    )
    const state = useWorkspaceStore.getState()
    expect(state.openNodeId).toBe('carol-node-2')
    expect(state.openThreadId).toBe('carol-thread-2')
    expect(state.composerFocusRequested).toBe(true)
  })

  it('sends a detailed start as topic and mode', async () => {
    await hydrateFrom(CAROL)
    const fetchMock = queued(CAROL_CREATED, CAROL_OPENED)

    await useWorkspaceStore.getState().createRootNode({ title: 'Types', mode: 'Deepen' })

    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ title: 'Types', mode: 'Deepen' }))
  })

  it('renames through the title route and applies the returned graph', async () => {
    await hydrateFrom(CAROL)
    const renamed = {
      ...CAROL,
      graph: {
        ...CAROL.graph,
        nodes: [{ ...node('carol-node-1', 'Type systems'), titleSource: 'learner' }],
      },
    }
    const fetchMock = queued(renamed)

    await useWorkspaceStore.getState().renameNode('carol-node-1', 'Type systems')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspace/nodes/carol-node-1/title')
    expect(useWorkspaceStore.getState().graph.nodes[0].title).toBe('Type systems')
  })

  it('refuses an empty rename without a request', async () => {
    await hydrateFrom(CAROL)
    const fetchMock = queued()

    expect(() => useWorkspaceStore.getState().renameNode('carol-node-1', '')).toThrow(/empty/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('archiving the open node leaves nothing open', async () => {
    await hydrateFrom({ ...CAROL, context: { lastOpenNodeId: 'carol-node-1', viewport: {} } })
    expect(useWorkspaceStore.getState().openNodeId).toBe('carol-node-1')
    const archived = {
      ...CAROL,
      graph: { nodes: [], links: [], threads: [], messages: [] },
      // Even if the saved context still names it, it is not there to open.
      context: { lastOpenNodeId: 'carol-node-1', viewport: {} },
    }
    const fetchMock = queued(archived)

    await useWorkspaceStore.getState().archiveNode('carol-node-1')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspace/nodes/carol-node-1/archive')
    expect(useWorkspaceStore.getState().openNodeId).toBeNull()
    expect(useWorkspaceStore.getState().openThreadId).toBeNull()
  })

  it('does not open a saved node the snapshot no longer carries', async () => {
    await hydrateFrom({ ...CAROL, context: { lastOpenNodeId: 'archived-node', viewport: {} } })

    expect(useWorkspaceStore.getState().openNodeId).toBeNull()
  })

  it('restores through the restore route', async () => {
    await hydrateFrom(CAROL)
    const fetchMock = queued(CAROL_CREATED)

    await useWorkspaceStore.getState().restoreNode('carol-node-2')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspace/nodes/carol-node-2/restore')
    expect(useWorkspaceStore.getState().graph.nodes.map((n) => n.id)).toContain('carol-node-2')
  })
})

describe('workspace store — revealing only what is shown', () => {
  beforeEach(() => {
    __resetIdCounter()
    useWorkspaceStore.getState().reset()
  })

  it('does not ask to reveal a message the open thread does not show', async () => {
    // The thread named is another node's, so the node opens on its main thread,
    // where the message is not.
    await useWorkspaceStore.getState().openSessionAt('n-cat', 't-haskell-once', 'm-on-2')

    expect(useWorkspaceStore.getState().revealedMessageId).toBeNull()
  })
})
