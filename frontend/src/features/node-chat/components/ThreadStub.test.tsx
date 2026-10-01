import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  THREAD_FUNCTORS_STALE,
  THREAD_HASKELL_MAIN,
  THREAD_HASKELL_THUNKS,
} from '../../../shared/lib/fixtures'
import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'

import ThreadStub from './ThreadStub'

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  __resetIdCounter()
})

describe('ThreadStub', () => {
  it('shows the thread name, message count and resolved anchor text', () => {
    render(<ThreadStub thread={THREAD_HASKELL_THUNKS} />)

    const stub = screen.getByRole('button')
    expect(stub).toHaveAccessibleName('Open thread "thunks" (2 messages)')
    expect(stub).toHaveAttribute('title', 'thunks on the heap')
    expect(stub).not.toHaveTextContent('stale')
  })

  it('expands its thread when activated', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<ThreadStub thread={THREAD_HASKELL_THUNKS} />)

    fireEvent.click(screen.getByRole('button'))

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-haskell-thunks')
  })

  it('stays rendered while its thread is expanded', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    useWorkspaceStore.getState().openThread('t-haskell-thunks')
    render(<ThreadStub thread={THREAD_HASKELL_THUNKS} />)

    const stub = screen.getByRole('button')
    expect(stub).toBeVisible()
    expect(stub).toHaveAttribute('aria-current', 'true')
  })

  it('renders a stale anchor from its stored excerpt and marks it stale', () => {
    render(<ThreadStub thread={THREAD_FUNCTORS_STALE} />)

    const stub = screen.getByRole('button')
    expect(stub).toHaveTextContent('stale')
    expect(stub.getAttribute('aria-label')).toMatch(/stale anchor/i)
    // The stored copy, not the text now sitting at those offsets.
    expect(stub).toHaveTextContent('preserving structure and the functor laws')
    expect(stub).not.toHaveTextContent('preserving identity and composition')
  })

  it('renders nothing for a main thread, which has no anchor', () => {
    const { container } = render(<ThreadStub thread={THREAD_HASKELL_MAIN} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('offers no mode, skills or MCP control', () => {
    render(<ThreadStub thread={THREAD_HASKELL_THUNKS} />)

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mode|skill|mcp/i })).not.toBeInTheDocument()
  })
})
