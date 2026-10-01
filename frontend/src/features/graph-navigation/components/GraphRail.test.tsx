import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import GraphRail, { MINIMAP_MIN_HEIGHT } from './GraphRail'

beforeEach(() => {
  cleanup()
  __resetIdCounter()
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.getState().openNode('n-haskell')
})

describe('GraphRail — roomy rail', () => {
  it('renders the full minimap by default', () => {
    render(<GraphRail />)

    expect(screen.getByTestId('graph-minimap')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-breadcrumb')).not.toBeInTheDocument()
  })

  it('renders the minimap at exactly the threshold height', () => {
    render(<GraphRail availableHeight={MINIMAP_MIN_HEIGHT} />)

    expect(screen.getByTestId('graph-minimap')).toBeInTheDocument()
  })
})

describe('GraphRail — constrained rail', () => {
  it('collapses to a breadcrumb below the threshold', () => {
    render(<GraphRail availableHeight={MINIMAP_MIN_HEIGHT - 1} />)

    expect(screen.getByTestId('graph-breadcrumb')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-minimap')).not.toBeInTheDocument()
  })

  it('names the path down to the open node', () => {
    render(<GraphRail availableHeight={200} />)

    const breadcrumb = screen.getByTestId('graph-breadcrumb')
    expect(breadcrumb).toHaveTextContent('Functional Programming')
    expect(breadcrumb).toHaveTextContent('Haskell')
  })

  it('names a path for a node reachable from two parents', () => {
    useWorkspaceStore.getState().openNode('n-functors')
    render(<GraphRail availableHeight={200} />)

    const breadcrumb = screen.getByTestId('graph-breadcrumb')
    expect(breadcrumb).toHaveTextContent('Functors')
    // One of the two parents is named — a breadcrumb is a single line.
    expect(breadcrumb.textContent).toMatch(/Haskell|Category Theory/)
  })

  it('expands to the full minimap on hover and collapses again on leave', () => {
    render(<GraphRail availableHeight={200} />)
    const region = screen.getByTestId('graph-breadcrumb-region')

    fireEvent.mouseEnter(region)
    expect(screen.getByTestId('graph-minimap')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-breadcrumb')).not.toBeInTheDocument()

    fireEvent.mouseLeave(region)
    expect(screen.getByTestId('graph-breadcrumb')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-minimap')).not.toBeInTheDocument()
  })

  it('expands on keyboard focus too, so the graph is reachable without a mouse', () => {
    render(<GraphRail availableHeight={200} />)

    fireEvent.focus(screen.getByTestId('graph-breadcrumb'))

    expect(screen.getByTestId('graph-minimap')).toBeInTheDocument()
  })

  it('keeps the expanded minimap navigable', () => {
    render(<GraphRail availableHeight={200} />)
    fireEvent.mouseEnter(screen.getByTestId('graph-breadcrumb-region'))

    fireEvent.click(screen.getByRole('button', { name: 'Functors' }))

    expect(useWorkspaceStore.getState().openNodeId).toBe('n-functors')
  })
})
