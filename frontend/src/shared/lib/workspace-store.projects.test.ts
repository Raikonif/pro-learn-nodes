import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAnchor } from './anchor-resolver'
import { FIXTURE_DEFAULT_PROJECT_ID, FIXTURE_GRAPH, messageById } from './fixtures'
import {
  PROJECT_FILTER_STORAGE_KEY,
  __resetIdCounter,
  readStoredProjectFilter,
  useWorkspaceStore,
} from './workspace-store'

const GENERAL = FIXTURE_DEFAULT_PROJECT_ID

function store() {
  return useWorkspaceStore.getState()
}

function node(id: string) {
  return store().graph.nodes.find((candidate) => candidate.id === id)
}

function projectIds(): string[] {
  return store().graph.projects.map((project) => project.id)
}

/** An Algebra project holding Haskell and Functors, as the learner would set it up. */
async function algebraWithHaskellAndFunctors(): Promise<string> {
  const id = await store().createProject('Algebra')
  await store().moveNodeToProject('n-haskell', id)
  await store().moveNodeToProject('n-functors', id)
  return id
}

beforeEach(() => {
  __resetIdCounter()
  window.localStorage.clear()
  store().reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('workspace store — projects', () => {
  it('starts with the default project holding every session', () => {
    expect(store().graph.projects).toEqual([expect.objectContaining({ id: GENERAL, isDefault: true })])
    expect(store().graph.nodes.every((candidate) => candidate.projectId === GENERAL)).toBe(true)
  })

  it('creates, renames and sets instructions without touching the others', async () => {
    const id = await store().createProject('  Algebra  ')
    expect(store().graph.projects.find((p) => p.id === id)).toMatchObject({ name: 'Algebra', instructions: '' })

    await store().setProjectInstructions(id, 'Prefer worked examples.')
    await store().renameProject(id, 'Algebra II')

    expect(store().graph.projects.find((p) => p.id === id)).toMatchObject({
      name: 'Algebra II',
      instructions: 'Prefer worked examples.',
    })
  })

  it('refuses an empty project name', async () => {
    await expect(store().createProject('   ')).rejects.toThrow('cannot be empty')
    const id = await store().createProject('Algebra')
    await expect(store().renameProject(id, '')).rejects.toThrow('cannot be empty')
  })

  it('moves a session between projects and changes only its membership', async () => {
    const id = await store().createProject('Algebra')
    const before = node('n-haskell')!
    const links = store().graph.links

    await store().moveNodeToProject('n-haskell', id)

    expect(node('n-haskell')).toEqual({ ...before, projectId: id })
    expect(store().graph.links).toBe(links)
  })

  it('refuses to move a session into a project that is not there', async () => {
    await expect(store().moveNodeToProject('n-haskell', 'p-missing')).rejects.toThrow('unknown project')
    expect(node('n-haskell')!.projectId).toBe(GENERAL)
  })
})

describe('workspace store — archiving a project', () => {
  it('takes its sessions off the graph and out of the project list, and keeps them restorable', async () => {
    const id = await algebraWithHaskellAndFunctors()

    await store().archiveProject(id)

    expect(projectIds()).toEqual([GENERAL])
    expect(store().graph.nodes.map((n) => n.id)).not.toContain('n-haskell')
    expect(store().graph.nodes.map((n) => n.id)).not.toContain('n-functors')
    expect(store().graph.links.every((l) => !['n-haskell', 'n-functors'].includes(l.parentId + l.childId))).toBe(true)
    await expect(store().fetchArchivedProjects()).resolves.toEqual([
      expect.objectContaining({ id, name: 'Algebra', nodeCount: 2 }),
    ])
  })

  it('closes the open session when its project is archived', async () => {
    const id = await algebraWithHaskellAndFunctors()
    store().openNode('n-haskell')

    await store().archiveProject(id)

    expect(store().openNodeId).toBeNull()
  })

  it('reports a link to archived material on the session that is still there', async () => {
    const id = await algebraWithHaskellAndFunctors()

    await store().archiveProject(id)

    // Category Theory stays and was the parent of Functors; Functional
    // Programming was the parent of Haskell.
    expect(store().graph.archivedLinks).toEqual(
      expect.arrayContaining([
        { nodeId: 'n-cat', archivedNodeId: 'n-functors', archivedTitle: 'Functors' },
        { nodeId: 'n-fp', archivedNodeId: 'n-haskell', archivedTitle: 'Haskell' },
      ]),
    )
  })

  it('refuses the default project, saying why', async () => {
    await expect(store().archiveProject(GENERAL)).rejects.toThrow('default project cannot be archived')
    expect(projectIds()).toEqual([GENERAL])
  })

  it('restores exactly the sessions it archived, leaving one archived on its own', async () => {
    const id = await algebraWithHaskellAndFunctors()
    await store().archiveNode('n-functors')
    await store().archiveProject(id)

    await store().restoreProject(id)

    expect(projectIds()).toContain(id)
    expect(node('n-haskell')).toBeDefined()
    expect(node('n-functors')).toBeUndefined()
    // The one archived on its own is restorable by itself now the project is back.
    await store().restoreNode('n-functors')
    expect(node('n-functors')!.projectId).toBe(id)
  })

  it('draws a link back once both ends are restored, and drops the archived-link marker', async () => {
    const id = await algebraWithHaskellAndFunctors()
    await store().archiveProject(id)
    expect(store().graph.archivedLinks.length).toBeGreaterThan(0)

    await store().restoreProject(id)

    expect(store().graph.archivedLinks).toEqual([])
    expect(store().graph.links.map((l) => l.id).sort()).toEqual(FIXTURE_GRAPH.links.map((l) => l.id).sort())
  })

  it('refuses to restore a session of an archived project, naming the project', async () => {
    const id = await algebraWithHaskellAndFunctors()
    await store().archiveProject(id)

    await expect(store().restoreNode('n-haskell')).rejects.toThrow('Restore the project Algebra first')

    expect(node('n-haskell')).toBeUndefined()
  })

  it('restores a session from an archived-link entry through the same action', async () => {
    const id = await store().createProject('Algebra')
    await store().moveNodeToProject('n-functors', id)
    await store().archiveNode('n-functors')

    await store().restoreNode('n-functors')

    expect(node('n-functors')).toBeDefined()
    expect(store().graph.archivedLinks).toEqual([])
  })
})

describe('workspace store — deleting a project', () => {
  it('moves its sessions, archived or not, to the default project and deletes none', async () => {
    const id = await algebraWithHaskellAndFunctors()
    await store().archiveNode('n-functors')

    await store().deleteProject(id)

    expect(projectIds()).toEqual([GENERAL])
    expect(node('n-haskell')!.projectId).toBe(GENERAL)
    // Still archived, now in the default project.
    expect(node('n-functors')).toBeUndefined()
    await store().restoreNode('n-functors')
    expect(node('n-functors')!.projectId).toBe(GENERAL)
  })

  it('refuses the default project', async () => {
    await expect(store().deleteProject(GENERAL)).rejects.toThrow('default project cannot be deleted')
  })
})

describe('workspace store — project membership of new sessions', () => {
  it('starts a root session in the named project, else the filtered one, else the default', async () => {
    const id = await store().createProject('Algebra')

    const named = await store().createRootNode({ title: 'A', projectId: id })
    expect(node(named)!.projectId).toBe(id)

    const plain = await store().createRootNode({ title: 'B' })
    expect(node(plain)!.projectId).toBe(GENERAL)

    store().setProjectFilter(id)
    const filtered = await store().createRootNode({ title: 'C' })
    expect(node(filtered)!.projectId).toBe(id)
  })

  it('branches into its source project unless another is named, and the link crosses either way', async () => {
    const id = await store().createProject('Algebra')
    const source = messageById(FIXTURE_GRAPH, 'm-hs-2')!
    const start = source.content.indexOf('infinite lists')
    const anchor = createAnchor(source, start, start + 'infinite lists'.length)

    const inherited = await store().generateNodeFrom('n-haskell', anchor)
    expect(node(inherited)!.projectId).toBe(GENERAL)

    const crossing = await store().generateNodeFrom('n-haskell', anchor, { projectId: id })
    expect(node(crossing)!.projectId).toBe(id)
    expect(store().graph.links).toContainEqual(
      expect.objectContaining({ parentId: 'n-haskell', childId: crossing }),
    )
  })

  it('gives a child its parent\'s project', async () => {
    const id = await store().createProject('Algebra')
    await store().moveNodeToProject('n-haskell', id)

    const child = await store().createChildNodeFrom('n-haskell')

    expect(node(child)!.projectId).toBe(id)
  })
})

describe('workspace store — the project filter', () => {
  it('is remembered per device', async () => {
    const id = await store().createProject('Algebra')

    store().setProjectFilter(id)

    expect(window.localStorage.getItem(PROJECT_FILTER_STORAGE_KEY)).toBe(id)
    expect(readStoredProjectFilter()).toBe(id)
    store().setProjectFilter(null)
    expect(window.localStorage.getItem(PROJECT_FILTER_STORAGE_KEY)).toBeNull()
  })

  it('refuses to filter to a project that does not exist', () => {
    store().setProjectFilter('p-gone')

    expect(store().projectFilter).toBeNull()
  })

  it('falls back to all projects when its project is deleted or archived', async () => {
    const deleted = await store().createProject('Gone')
    store().setProjectFilter(deleted)
    await store().deleteProject(deleted)
    expect(store().projectFilter).toBeNull()
    expect(readStoredProjectFilter()).toBeNull()

    const archived = await store().createProject('Away')
    store().setProjectFilter(archived)
    await store().archiveProject(archived)
    expect(store().projectFilter).toBeNull()
  })

  it('drops a remembered project the next snapshot does not carry, and keeps one it does', async () => {
    const snapshot = (projects: Array<{ id: string }>) => ({
      schemaVersion: 1,
      workspaceId: 'workspace-1',
      revision: 1,
      graph: {
        nodes: [],
        links: [],
        threads: [],
        messages: [],
        projects: projects.map((p) => ({ ...p, name: p.id, instructions: '', isDefault: false, createdAt: '2026-09-01T00:00:00.000Z' })),
        archivedLinks: [],
      },
      context: { lastOpenNodeId: null, viewport: {} },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot([{ id: 'p-kept' }])))))
    window.localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, 'p-kept')
    useWorkspaceStore.setState({ projectFilter: 'p-kept', workspaceId: null, status: 'loading' })

    await store().hydrate()
    expect(store().projectFilter).toBe('p-kept')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot([])))))
    await store().hydrate()
    expect(store().projectFilter).toBeNull()
  })

  it('reads as all projects when storage cannot be read, and still sets one', async () => {
    const id = await store().createProject('Algebra')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(readStoredProjectFilter()).toBeNull()
    expect(() => store().setProjectFilter(id)).not.toThrow()
    expect(store().projectFilter).toBe(id)
  })
})

describe('workspace store — projects through the backend', () => {
  const NODE = {
    id: 'n1',
    title: 'T',
    mode: 'Explore',
    body: '',
    activeSkills: [],
    mcpServers: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    lastOpenedAt: '2026-09-01T00:00:00.000Z',
    projectId: 'p-general',
  }
  const GENERAL_PROJECT = {
    id: 'p-general',
    name: 'General',
    instructions: '',
    isDefault: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  }

  function snapshot(projects: unknown[]) {
    return {
      schemaVersion: 1,
      workspaceId: 'workspace-1',
      revision: 2,
      graph: {
        nodes: [NODE],
        links: [],
        threads: [{ id: 't1', nodeId: 'n1', name: 'main', anchor: null }],
        messages: [],
        projects,
        archivedLinks: [],
      },
      context: { lastOpenNodeId: null, viewport: {} },
    }
  }

  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaceId: 'workspace-1',
      status: 'ready',
      graph: { nodes: [], links: [], threads: [], messages: [], projects: [GENERAL_PROJECT], archivedLinks: [] },
    })
  })

  it('replaces the graph with the snapshot a project route answers with, and returns the new id', async () => {
    const created = { id: 'p-new', name: 'Algebra', instructions: '', isDefault: false, createdAt: '2026-09-02T00:00:00.000Z' }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snapshot([GENERAL_PROJECT, created]))))
    vi.stubGlobal('fetch', fetchMock)

    await expect(store().createProject('Algebra')).resolves.toBe('p-new')

    expect(store().graph.projects.map((p) => p.id)).toEqual(['p-general', 'p-new'])
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/projects', expect.objectContaining({ method: 'POST' }))
  })

  it('passes the backend\'s refusal reason through to the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'Restore the project Algebra first' }), { status: 422 }),
      ),
    )

    await expect(store().restoreNode('n1')).rejects.toThrow('Restore the project Algebra first')
  })

  it('reads the archived projects from the backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              projects: [{ id: 'p-old', name: 'Old', archivedAt: '2026-09-02T00:00:00.000Z', nodeCount: 4 }],
            }),
          ),
      ),
    )

    await expect(store().fetchArchivedProjects()).resolves.toEqual([
      { id: 'p-old', name: 'Old', archivedAt: '2026-09-02T00:00:00.000Z', nodeCount: 4 },
    ])
  })

  it('tolerates a backend that predates projects', async () => {
    const old = snapshot([])
    const { projects: _projects, archivedLinks: _links, ...graph } = old.graph
    const { projectId: _projectId, ...node } = NODE
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...old, graph: { ...graph, nodes: [node] } }))),
    )

    await store().hydrate()

    expect(store().status).toBe('ready')
    expect(store().graph.projects).toEqual([])
    expect(store().graph.archivedLinks).toEqual([])
    expect(store().graph.nodes[0].projectId).toBeNull()
  })
})
