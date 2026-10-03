import { afterEach, describe, expect, it, vi } from 'vitest'

import * as workspaceApi from './workspace-api'
import type { SelectionAnchor } from './workspace-types'

const ANCHOR: SelectionAnchor = {
  messageId: 'message-1',
  start: 0,
  end: 5,
  excerpt: 'hello',
}

const SNAPSHOT = {
  schemaVersion: 1,
  workspaceId: 'workspace-1',
  revision: 1,
  graph: { nodes: [], links: [], threads: [], messages: [] },
  context: { lastOpenNodeId: null, viewport: {} },
}

/**
 * Every request helper the module exports, with arguments that reach the wire.
 *
 * Keyed by export name and cross-checked against the module's actual exports
 * below, so a route added without an entry here fails the coverage test rather
 * than silently escaping the "no workspace is named" assertion.
 */
const INVOCATIONS: Record<string, () => Promise<unknown>> = {
  loadWorkspace: () => workspaceApi.loadWorkspace(),
  branchNode: () => workspaceApi.branchNode('node-1', ANCHOR, { title: 'Branched' }),
  createChildNode: () => workspaceApi.createChildNode('node-1'),
  createThread: () => workspaceApi.createThread('node-1', ANCHOR, 'side'),
  appendMessage: () => workspaceApi.appendMessage('thread-1', 'learner', 'hello'),
  saveWorkspaceContext: () => workspaceApi.saveWorkspaceContext('node-1', { x: 1 }),
  setNodeBackend: () => workspaceApi.setNodeBackend('node-1', 'agent-1'),
  setNodeAgentSettings: () => workspaceApi.setNodeAgentSettings('node-1', { model: 'opus' }),
  createRootNode: () => workspaceApi.createRootNode({ title: 'Monads', mode: 'Deepen' }),
  renameNode: () => workspaceApi.renameNode('node-1', 'Renamed'),
  archiveNode: () => workspaceApi.archiveNode('node-1'),
  restoreNode: () => workspaceApi.restoreNode('node-1'),
  searchSessions: () => workspaceApi.searchSessions('monads', { includeArchived: true }),
  createProject: () => workspaceApi.createProject('Algebra'),
  updateProject: () => workspaceApi.updateProject('project-1', { name: 'Algebra II' }),
  archiveProject: () => workspaceApi.archiveProject('project-1'),
  restoreProject: () => workspaceApi.restoreProject('project-1'),
  deleteProject: () => workspaceApi.deleteProject('project-1'),
  moveNodeToProject: () => workspaceApi.moveNodeToProject('node-1', 'project-1'),
  loadArchivedProjects: () => workspaceApi.loadArchivedProjects(),
}

const ARCHIVED_PROJECTS = {
  projects: [{ id: 'project-1', name: 'Algebra', archivedAt: '2026-09-02T10:00:00.000Z', nodeCount: 3 }],
}

const SEARCH = {
  results: [
    {
      nodeId: 'node-1',
      title: 'Monads',
      archived: false,
      threadId: 'thread-1',
      messageId: 'message-1',
      snippet: 'a <b>monad</b> is',
      lastActivityAt: '2026-09-01T10:00:00.000Z',
    },
  ],
}

/** Answers the search and archived-projects routes with their lists and every other route with a snapshot. */
function routedFetch() {
  return vi.fn<typeof fetch>((input) => {
    const url = String(input)
    const body = url.includes('/sessions/search')
      ? SEARCH
      : url.includes('/projects/archived')
        ? ARCHIVED_PROJECTS
        : SNAPSHOT
    return Promise.resolve(new Response(JSON.stringify(body)))
  })
}

function lastCall(fetchMock: ReturnType<typeof routedFetch>) {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] ?? []
  return { url: String(url), method: init?.method, body: init?.body }
}

function exportedHelpers(): string[] {
  return Object.entries(workspaceApi)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort()
}

/** Collects keys at every depth: a nested `workspaceId` names a workspace too. */
function deepKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(deepKeys)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...deepKeys(child),
  ])
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspace api', () => {
  it('exports no request helper that this suite leaves unexercised', () => {
    expect(exportedHelpers()).toEqual(Object.keys(INVOCATIONS).sort())
  })

  it('never names a workspace in a request body', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    for (const invoke of Object.values(INVOCATIONS)) await invoke()

    const bodies = fetchMock.mock.calls
      .map(([, init]) => init?.body)
      .filter((body): body is string => typeof body === 'string')
      .map((body) => JSON.parse(body) as unknown)

    // A body-less GET is legitimate, but a run that produced no bodies at all
    // would pass the assertion below without having tested anything.
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) expect(deepKeys(body)).not.toContain('workspaceId')
  })

  it('puts a node backend change to the node route', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(SNAPSHOT))),
    )
    vi.stubGlobal('fetch', fetchMock)

    await workspaceApi.setNodeBackend('node-1', 'agent-1')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/workspace/nodes/node-1/backend')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe(JSON.stringify({ agentId: 'agent-1' }))
  })

  it('puts a node\'s agent settings, sending only the keys given (null resets one)', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(SNAPSHOT))),
    )
    vi.stubGlobal('fetch', fetchMock)

    await workspaceApi.setNodeAgentSettings('node 1', { model: null, mode: 'auto', confirmedUnasked: true })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/workspace/nodes/node%201/agent-settings')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({ model: null, mode: 'auto', confirmedUnasked: true })
  })

  it('creates a root session with nothing chosen as an empty body', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    await workspaceApi.createRootNode()

    expect(lastCall(fetchMock)).toEqual({
      url: '/api/workspace/nodes',
      method: 'POST',
      body: JSON.stringify({}),
    })
  })

  it('omits a blank topic so the session is titled automatically', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    await workspaceApi.createRootNode({ title: '   ', mode: 'Quiz' })

    expect(lastCall(fetchMock).body).toBe(JSON.stringify({ mode: 'Quiz' }))
  })

  it('sends a chosen topic and mode', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    await workspaceApi.createRootNode({ title: ' Monads ', mode: 'Deepen' })

    expect(lastCall(fetchMock).body).toBe(JSON.stringify({ title: 'Monads', mode: 'Deepen' }))
  })

  it('puts a rename to the node title route', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    await workspaceApi.renameNode('node/1', 'Kleisli')

    expect(lastCall(fetchMock)).toEqual({
      url: '/api/workspace/nodes/node%2F1/title',
      method: 'PUT',
      body: JSON.stringify({ title: 'Kleisli' }),
    })
  })

  it('posts archive and restore to their node routes', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    await workspaceApi.archiveNode('node-1')
    expect(lastCall(fetchMock)).toMatchObject({
      url: '/api/workspace/nodes/node-1/archive',
      method: 'POST',
    })

    await workspaceApi.restoreNode('node-1')
    expect(lastCall(fetchMock)).toMatchObject({
      url: '/api/workspace/nodes/node-1/restore',
      method: 'POST',
    })
  })

  it('reaches the project routes with the contract methods and bodies', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)
    const calls: Array<[() => Promise<unknown>, string, string, unknown]> = [
      [() => workspaceApi.createProject('Algebra'), '/api/workspace/projects', 'POST', { name: 'Algebra' }],
      [
        () => workspaceApi.updateProject('project-1', { instructions: 'Be terse' }),
        '/api/workspace/projects/project-1',
        'PATCH',
        { instructions: 'Be terse' },
      ],
      [() => workspaceApi.archiveProject('project-1'), '/api/workspace/projects/project-1/archive', 'POST', {}],
      [() => workspaceApi.restoreProject('project-1'), '/api/workspace/projects/project-1/restore', 'POST', {}],
      [() => workspaceApi.deleteProject('project-1'), '/api/workspace/projects/project-1', 'DELETE', undefined],
      [
        () => workspaceApi.moveNodeToProject('node-1', 'project-1'),
        '/api/workspace/nodes/node-1/project',
        'PUT',
        { projectId: 'project-1' },
      ],
    ]
    for (const [invoke, url, method, body] of calls) {
      await invoke()
      const call = lastCall(fetchMock)
      expect(call).toMatchObject({ url, method })
      expect(call.body === undefined ? undefined : JSON.parse(String(call.body))).toEqual(body)
    }
  })

  it('reads the archived projects as a list', async () => {
    vi.stubGlobal('fetch', routedFetch())
    await expect(workspaceApi.loadArchivedProjects()).resolves.toEqual(ARCHIVED_PROJECTS.projects)
  })

  it('names the project on creation only when one is chosen', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    await workspaceApi.createRootNode({ title: 'Monads' })
    expect(JSON.parse(String(lastCall(fetchMock).body))).toEqual({ title: 'Monads' })

    await workspaceApi.createRootNode({ projectId: 'project-1' })
    expect(JSON.parse(String(lastCall(fetchMock).body))).toEqual({ projectId: 'project-1' })

    await workspaceApi.branchNode('node-1', ANCHOR, undefined, 'project-2')
    expect(JSON.parse(String(lastCall(fetchMock).body))).toMatchObject({ projectId: 'project-2' })
  })

  it('surfaces the backend reason when a restore or project action is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(JSON.stringify({ detail: 'Restore the project Algebra first' }), { status: 422 })),
      ),
    )
    await expect(workspaceApi.restoreNode('node-1')).rejects.toThrow('Restore the project Algebra first')
    await expect(workspaceApi.archiveProject('project-1')).rejects.toThrow('Restore the project Algebra first')
  })

  it('parses a snapshot that predates projects, and one that carries them', () => {
    const old = workspaceApi.WorkspaceBootstrapSchema.parse({
      ...SNAPSHOT,
      graph: {
        nodes: [
          {
            id: 'n',
            title: 'T',
            mode: 'Explore',
            body: '',
            activeSkills: [],
            mcpServers: [],
            createdAt: '2026-08-01T00:00:00.000Z',
            lastOpenedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        links: [],
        threads: [],
        messages: [],
      },
    })
    expect(old.graph.projects).toEqual([])
    expect(old.graph.archivedLinks).toEqual([])
    expect(old.graph.nodes[0].projectId).toBeNull()

    const current = workspaceApi.WorkspaceBootstrapSchema.parse({
      ...SNAPSHOT,
      graph: {
        ...SNAPSHOT.graph,
        projects: [
          { id: 'p', name: 'General', instructions: '', isDefault: true, createdAt: '2026-08-01T00:00:00.000Z' },
        ],
        archivedLinks: [{ nodeId: 'a', archivedNodeId: 'b', archivedTitle: 'B' }],
      },
    })
    expect(current.graph.projects[0]).toMatchObject({ id: 'p', isDefault: true })
    expect(current.graph.archivedLinks).toEqual([{ nodeId: 'a', archivedNodeId: 'b', archivedTitle: 'B' }])
  })

  it('offers no way to delete a session — only a project, whose sessions move', () => {
    expect(exportedHelpers().filter((name) => /delete/i.test(name))).toEqual(['deleteProject'])
  })

  it('searches with the query and the archived flag in the query string', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    const results = await workspaceApi.searchSessions('lazy & strict')

    const { url, method } = lastCall(fetchMock)
    expect(method).toBe('GET')
    const parsed = new URL(url, 'http://localhost')
    expect(parsed.pathname).toBe('/api/workspace/sessions/search')
    expect(parsed.searchParams.get('q')).toBe('lazy & strict')
    expect(parsed.searchParams.get('includeArchived')).toBe('false')
    expect(results).toEqual(SEARCH.results)
  })

  it('reads a title-only match, which names no message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                {
                  nodeId: 'node-1',
                  title: 'Monads',
                  archived: true,
                  threadId: null,
                  messageId: null,
                  snippet: null,
                  lastActivityAt: '2026-09-01T10:00:00.000Z',
                },
              ],
            }),
          ),
        ),
      ),
    )

    const [result] = await workspaceApi.searchSessions('monads', { includeArchived: true })

    expect(result).toMatchObject({ archived: true, messageId: null, threadId: null })
  })
})
