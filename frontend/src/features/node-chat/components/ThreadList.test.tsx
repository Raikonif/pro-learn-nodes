import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'

import ThreadList from './ThreadList'

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  __resetIdCounter()
})

describe('ThreadList', () => {
  it('enumerates every thread on the open node, including nested ones', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<ThreadList />)

    const names = within(screen.getByRole('navigation', { name: 'Threads on this node' }))
      .getAllByRole('button')
      .map((b) => b.textContent)

    // `t-haskell-once` lives two levels deep and is still listed here.
    expect(names).toEqual([
      expect.stringContaining('main'),
      expect.stringContaining('thunks'),
      expect.stringContaining('evaluated at most once'),
    ])
  })

  it('lists no thread belonging to another node', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<ThreadList />)

    expect(screen.queryByText('which laws exactly')).not.toBeInTheDocument()
  })

  it('expands the selected thread', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<ThreadList />)

    fireEvent.click(screen.getByText('evaluated at most once'))

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-haskell-once')
    expect(useWorkspaceStore.getState().openNodeId).toBe('n-haskell')
  })

  it('reaches a thread whose anchor is stale', () => {
    useWorkspaceStore.getState().openNode('n-functors')
    render(<ThreadList />)

    const stale = screen.getByText('which laws exactly')
    fireEvent.click(stale)

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-functors-laws')
  })

  it('shows a thread just created from a selection', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const threadId = useWorkspaceStore
      .getState()
      .createThreadFrom('n-haskell', {
        messageId: 'm-hs-4',
        start: 0,
        end: 11,
        excerpt: 'Space leaks',
      })
    render(<ThreadList />)

    fireEvent.click(screen.getByText('Space leaks'))

    expect(useWorkspaceStore.getState().openThreadId).toBe(threadId)
  })

  it('offers no per-thread mode, skills or MCP control', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<ThreadList />)

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mode|skill|mcp/i })).not.toBeInTheDocument()
  })

  it('renders nothing when no node is open', () => {
    const { container } = render(<ThreadList />)

    expect(container).toBeEmptyDOMElement()
  })
})
