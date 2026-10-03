import { beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { FIXTURE_GRAPH } from '../../../shared/lib/fixtures'
import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import GraphCanvas, { layoutGraph, workspaceGraphToReactFlow } from './GraphCanvas'

beforeEach(() => {
  cleanup()
  __resetIdCounter()
  useWorkspaceStore.getState().reset()
})

describe('workspaceGraphToReactFlow', () => {
  it('derives one typed card node per workspace node and no thread nodes', () => {
    const derived = workspaceGraphToReactFlow(FIXTURE_GRAPH)

    expect(derived.nodes).toHaveLength(FIXTURE_GRAPH.nodes.length)
    expect(derived.nodes.map((node) => node.id)).toEqual(FIXTURE_GRAPH.nodes.map((node) => node.id))
    expect(derived.nodes.every((node) => node.type === 'chatCard')).toBe(true)
    expect(derived.nodes.every((node) => node.data.nodeId.startsWith('n-'))).toBe(true)
    expect(derived.nodes.some((node) => node.id.startsWith('t-'))).toBe(false)
  })

  it('derives directed edges with the domain link anchor intact', () => {
    const derived = workspaceGraphToReactFlow(FIXTURE_GRAPH)

    expect(derived.edges).toHaveLength(FIXTURE_GRAPH.links.length)
    expect(derived.edges.map((edge) => [edge.source, edge.target])).toContainEqual([
      'n-haskell',
      'n-functors',
    ])
    expect(derived.edges.find((edge) => edge.id === 'l-haskell-functors')?.data?.anchor).toEqual(
      FIXTURE_GRAPH.links.find((link) => link.id === 'l-haskell-functors')?.anchor,
    )
    expect(derived.edges.every((edge) => edge.markerEnd)).toBe(true)
  })
})

describe('layoutGraph', () => {
  it('places every branch edge top-to-bottom and keeps repeated layouts stable', () => {
    const layout = layoutGraph(FIXTURE_GRAPH)
    const yOf = (id: string) => layout.nodes.find((positioned) => positioned.node.id === id)!.y

    for (const link of FIXTURE_GRAPH.links) {
      expect(yOf(link.childId)).toBeGreaterThan(yOf(link.parentId))
    }
    expect(layoutGraph(FIXTURE_GRAPH)).toEqual(layout)
    expect(layout.nodes.every((positioned) => positioned.width > 0)).toBe(true)
    expect(layout.nodes.every((positioned) => positioned.height > 0)).toBe(true)
  })
})

describe('GraphCanvas', () => {
  it('renders every node as a card and exposes viewport controls', () => {
    render(<GraphCanvas />)

    expect(screen.getAllByTestId('graph-node-card')).toHaveLength(FIXTURE_GRAPH.nodes.length)
    for (const node of FIXTURE_GRAPH.nodes) {
      expect(screen.getByRole('button', { name: node.title })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: node.title })).toHaveAttribute('data-mode', node.mode)
    }
    expect(screen.getByRole('button', { name: 'Zoom In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom Out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fit View' })).toBeInTheDocument()
    expect(
      screen
        .getAllByTestId('graph-node-card')
        .map((card) => card.getAttribute('data-node-id')),
    ).not.toContain('t-haskell-thunks')
  })

  it('opens a node on card activation', () => {
    render(<GraphCanvas />)

    fireEvent.click(screen.getByRole('button', { name: 'Functors' }))
    expect(useWorkspaceStore.getState().openNodeId).toBe('n-functors')

    act(() => useWorkspaceStore.getState().closeNode())
    fireEvent.keyDown(screen.getByRole('button', { name: 'Haskell' }), { key: 'Enter' })
    expect(useWorkspaceStore.getState().openNodeId).toBe('n-haskell')
  })

  it('creates a whole-node child from plus without activating the parent card', () => {
    render(<GraphCanvas />)
    const parent = screen.getByRole('button', { name: 'Haskell' })
    const parentPlus = within(parent).getByRole('button', {
      name: 'Create child node from Haskell',
    })

    fireEvent.click(parentPlus)

    const state = useWorkspaceStore.getState()
    const child = state.graph.nodes[state.graph.nodes.length - 1]
    expect(child.id).toBe(state.openNodeId)
    expect(state.openNodeId).not.toBe('n-haskell')
    expect(state.graph.links.find((link) => link.childId === child.id)).toMatchObject({
      parentId: 'n-haskell',
      anchor: null,
    })
  })

  it('keeps whole-node and selected-text links distinct', () => {
    render(<GraphCanvas />)

    act(() => {
      useWorkspaceStore.getState().createChildNodeFrom('n-haskell')
      useWorkspaceStore.getState().generateNodeFrom('n-haskell', {
        messageId: 'm-hs-2',
        start: 0,
        end: 7,
        excerpt: 'Haskell',
      })
    })

    const { links } = useWorkspaceStore.getState().graph
    expect(links[links.length - 2]?.anchor).toBeNull()
    expect(links[links.length - 1]?.anchor).toEqual({
      messageId: 'm-hs-2',
      start: 0,
      end: 7,
      excerpt: 'Haskell',
    })
  })

  it('refreshes derived cards when the domain graph changes', () => {
    render(<GraphCanvas />)

    act(() => useWorkspaceStore.getState().createChildNodeFrom('n-haskell'))

    expect(screen.getByRole('button', { name: 'New child of Haskell' })).toBeInTheDocument()
  })

  it('only marks the open node active in the minimap variant', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<GraphCanvas variant="minimap" />)

    expect(screen.getByRole('button', { name: 'Haskell' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Functors' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByTestId('create-child-node')).not.toBeInTheDocument()
  })

  it('renders the compact React Flow navigator without canvas controls', () => {
    render(<GraphCanvas variant="minimap" />)

    expect(screen.getByRole('group', { name: 'Session graph minimap' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zoom In' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zoom Out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fit View' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create child node/i })).not.toBeInTheDocument()
  })
})

// ── Projects ─────────────────────────────────────────────────────────────

const store = () => useWorkspaceStore.getState()

/** Algebra holds Haskell and Functors; everything else stays in General. */
async function splitIntoProjects(): Promise<string> {
  let id = ''
  await act(async () => {
    id = await store().createProject('Algebra')
    await store().moveNodeToProject('n-haskell', id)
    await store().moveNodeToProject('n-functors', id)
  })
  return id
}

describe('project regions', () => {
  it('draws no region while every card belongs to the default project', () => {
    const derived = workspaceGraphToReactFlow(store().graph)

    expect(derived.regions).toEqual([])
  })

  it('draws one labelled region per project, around exactly its laid-out cards', async () => {
    const id = await splitIntoProjects()
    const derived = workspaceGraphToReactFlow(store().graph)

    expect(derived.regions.map((region) => region.data.name)).toEqual(['General', 'Algebra'])
    const algebra = derived.regions.find((region) => region.data.projectId === id)!
    for (const card of derived.nodes.filter((n) => n.data.node.projectId === id)) {
      expect(card.position.x).toBeGreaterThanOrEqual(algebra.position.x)
      expect(card.position.y).toBeGreaterThanOrEqual(algebra.position.y)
      expect(card.position.x + 224).toBeLessThanOrEqual(algebra.position.x + (algebra.width ?? 0))
      expect(card.position.y + 112).toBeLessThanOrEqual(algebra.position.y + (algebra.height ?? 0))
    }
  })

  it('puts regions behind the cards and out of reach', async () => {
    await splitIntoProjects()
    const { regions } = workspaceGraphToReactFlow(store().graph)

    for (const region of regions) {
      expect(region.zIndex).toBeLessThan(0)
      expect(region.selectable).toBe(false)
      expect(region.draggable).toBe(false)
      expect(region.focusable).toBe(false)
      expect(region.style).toMatchObject({ pointerEvents: 'none' })
    }
  })

  it('leaves every card and every link as without projects, so a link crosses regions untouched', async () => {
    const before = workspaceGraphToReactFlow(store().graph)
    await splitIntoProjects()
    const after = workspaceGraphToReactFlow(store().graph)

    expect(after.nodes.map((n) => [n.id, n.position])).toEqual(before.nodes.map((n) => [n.id, n.position]))
    expect(after.edges.map((e) => [e.id, e.source, e.target])).toEqual(
      before.edges.map((e) => [e.id, e.source, e.target]),
    )
    // Haskell (Algebra) -> Lazy Evaluation (General): a crossing link, drawn.
    expect(after.edges.map((e) => [e.source, e.target])).toContainEqual(['n-haskell', 'n-lazy-evaluation'])
  })

  it('omits a project with no rendered cards, e.g. one whose sessions are archived', async () => {
    const id = await splitIntoProjects()
    await act(async () => store().archiveProject(id))

    expect(workspaceGraphToReactFlow(store().graph).regions).toEqual([])
  })

  it('draws none in the minimap', async () => {
    await splitIntoProjects()

    expect(workspaceGraphToReactFlow(store().graph, { variant: 'minimap' }).regions).toEqual([])
  })

  it('renders the label behind the cards without making it a session or a control', async () => {
    await splitIntoProjects()
    render(<GraphCanvas />)

    const labels = screen.getAllByTestId('project-region-label').map((label) => label.textContent)
    expect(labels).toEqual(['General', 'Algebra'])
    expect(screen.getAllByTestId('graph-node-card')).toHaveLength(FIXTURE_GRAPH.nodes.length)
    expect(screen.queryByRole('button', { name: 'Algebra' })).not.toBeInTheDocument()

    // A click that lands on a region opens nothing.
    fireEvent.click(screen.getAllByTestId('project-region')[0])
    expect(store().openNodeId).toBeNull()
  })
})

describe('links to archived sessions', () => {
  async function archiveFunctors(): Promise<void> {
    await act(async () => store().archiveNode('n-functors'))
  }

  it('derives the entries onto the card of the end that is still there', async () => {
    await archiveFunctors()
    const derived = workspaceGraphToReactFlow(store().graph)

    expect(derived.nodes.find((n) => n.id === 'n-haskell')!.data.archivedLinks).toEqual([
      { nodeId: 'n-haskell', archivedNodeId: 'n-functors', archivedTitle: 'Functors' },
    ])
    expect(derived.nodes.find((n) => n.id === 'n-fp')!.data.archivedLinks).toEqual([])
  })

  it('says "linked to N archived" on that card only', async () => {
    await archiveFunctors()
    render(<GraphCanvas />)

    const toggles = screen.getAllByTestId('archived-links-toggle')
    // Haskell and Category Theory were Functors' parents.
    expect(toggles.map((t) => t.textContent)).toEqual(['linked to 1 archived', 'linked to 1 archived'])
    expect(within(screen.getByRole('button', { name: 'Haskell' })).getByTestId('archived-links-toggle')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Lazy Evaluation' })).queryByTestId('archived-links-toggle')).toBeNull()
  })

  it('lists the archived sessions on activation without opening the card', async () => {
    await archiveFunctors()
    render(<GraphCanvas />)
    const card = screen.getByRole('button', { name: 'Haskell' })

    fireEvent.click(within(card).getByTestId('archived-links-toggle'))

    const list = within(card).getByRole('list', { name: 'Archived links' })
    expect(within(list).getByText('Functors')).toBeInTheDocument()
    expect(store().openNodeId).toBeNull()
  })

  it('restores through the existing action and draws the link again', async () => {
    await archiveFunctors()
    render(<GraphCanvas />)
    const card = screen.getByRole('button', { name: 'Haskell' })
    fireEvent.click(within(card).getByTestId('archived-links-toggle'))

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Restore Functors' }))
    })

    expect(store().graph.nodes.some((n) => n.id === 'n-functors')).toBe(true)
    expect(store().graph.links.some((l) => l.parentId === 'n-haskell' && l.childId === 'n-functors')).toBe(true)
    expect(screen.queryByTestId('archived-links-toggle')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Functors' })).toBeInTheDocument()
  })

  it('shows the backend\'s refusal when the archived session\'s project is archived', async () => {
    const id = await splitIntoProjects()
    await act(async () => store().archiveProject(id))
    // Functors is now archived with Algebra; Category Theory still links to it.
    render(<GraphCanvas />)
    const card = screen.getByRole('button', { name: 'Category Theory' })
    fireEvent.click(within(card).getByTestId('archived-links-toggle'))

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Restore Functors' }))
    })

    expect(within(card).getByRole('alert')).toHaveTextContent('Restore the project Algebra first')
  })

  it('shows nothing in the minimap', async () => {
    await archiveFunctors()
    render(<GraphCanvas variant="minimap" />)

    expect(screen.queryByTestId('archived-links-toggle')).not.toBeInTheDocument()
  })
})
