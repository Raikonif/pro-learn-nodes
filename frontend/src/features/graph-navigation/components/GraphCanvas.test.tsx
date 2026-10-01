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
