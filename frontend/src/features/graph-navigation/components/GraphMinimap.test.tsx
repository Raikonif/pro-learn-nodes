import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { FIXTURE_GRAPH } from '../../../shared/lib/fixtures'
import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import GraphMinimap from './GraphMinimap'

beforeEach(() => {
  cleanup()
  __resetIdCounter()
  useWorkspaceStore.getState().reset()
})

describe('GraphMinimap', () => {
  it('renders the whole graph, not just the open node', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<GraphMinimap />)

    for (const node of FIXTURE_GRAPH.nodes) {
      expect(screen.getByRole('button', { name: node.title })).toBeInTheDocument()
    }
  })

  it('distinguishes the open node from every other node', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<GraphMinimap />)

    const haskell = screen.getByRole('button', { name: 'Haskell' })
    expect(haskell).toHaveAttribute('aria-current', 'true')
    expect(haskell).toHaveAttribute('data-current', 'true')

    for (const other of ['Functors', 'Category Theory', 'Functional Programming']) {
      const node = screen.getByRole('button', { name: other })
      expect(node).not.toHaveAttribute('aria-current')
      // The highlight is visual as well as semantic: the marked node carries
      // different classes from its peers.
      expect(node.getAttribute('class')).not.toBe(haskell.getAttribute('class'))
    }
  })

  it('moves the highlight when the open node changes', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<GraphMinimap />)

    fireEvent.click(screen.getByRole('button', { name: 'Category Theory' }))

    expect(screen.getByRole('button', { name: 'Category Theory' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Haskell' })).not.toHaveAttribute('aria-current')
  })

  it('navigates straight to another node without closing the current one first', () => {
    useWorkspaceStore.getState().openNode('n-haskell')

    // Record every openNodeId the store passes through. A close-then-open
    // implementation would show a null in this sequence, which is the frame
    // where the center graph would flash back.
    const seen: (string | null)[] = []
    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      seen.push(state.openNodeId)
    })

    render(<GraphMinimap />)
    fireEvent.click(screen.getByRole('button', { name: 'Functors' }))
    unsubscribe()

    expect(useWorkspaceStore.getState().openNodeId).toBe('n-functors')
    expect(seen).not.toContain(null)
    expect(seen[seen.length - 1]).toBe('n-functors')
  })

  it('switches the open thread to the newly activated node', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<GraphMinimap />)

    fireEvent.click(screen.getByRole('button', { name: 'Functors' }))

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-functors-main')
  })

  it('uses the minimap variant of the canvas', () => {
    render(<GraphMinimap />)

    expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-variant', 'minimap')
  })
})
