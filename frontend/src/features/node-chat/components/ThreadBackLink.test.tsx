import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  THREAD_FUNCTORS_STALE,
  THREAD_HASKELL_MAIN,
  THREAD_HASKELL_ONCE,
  THREAD_HASKELL_THUNKS,
} from '../../../shared/lib/fixtures'
import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'

import ThreadBackLink from './ThreadBackLink'
import { stubElementId } from './ThreadStub'

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  __resetIdCounter()
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ThreadBackLink', () => {
  it('names the passage the thread was spawned from', () => {
    render(<ThreadBackLink thread={THREAD_HASKELL_THUNKS} />)

    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Back to the source thread — from: thunks on the heap',
    )
    expect(screen.getByText(/from:/)).toBeInTheDocument()
  })

  it('returns to the source thread when activated', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    useWorkspaceStore.getState().openThread('t-haskell-thunks')
    render(<ThreadBackLink thread={THREAD_HASKELL_THUNKS} />)

    fireEvent.click(screen.getByRole('button'))

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-haskell-main')
    expect(useWorkspaceStore.getState().openNodeId).toBe('n-haskell')
  })

  it('returns a nested thread to the thread that spawned it, not to main', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    useWorkspaceStore.getState().openThread('t-haskell-once')
    render(<ThreadBackLink thread={THREAD_HASKELL_ONCE} />)

    fireEvent.click(screen.getByRole('button'))

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-haskell-thunks')
  })

  it('scrolls to the stub of the thread it came from', async () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    useWorkspaceStore.getState().openThread('t-haskell-thunks')
    render(
      <>
        <ThreadBackLink thread={THREAD_HASKELL_THUNKS} />
        {/* Stands in for the stub the source thread re-renders. */}
        <div id={stubElementId('t-haskell-thunks')} />
      </>,
    )

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('presents a stale anchor from its stored excerpt', () => {
    render(<ThreadBackLink thread={THREAD_FUNCTORS_STALE} />)

    const link = screen.getByRole('button')
    expect(link).toHaveTextContent('preserving structure and the functor laws')
    expect(link).toHaveTextContent('stale')
  })

  it('renders nothing for a main thread', () => {
    const { container } = render(<ThreadBackLink thread={THREAD_HASKELL_MAIN} />)

    expect(container).toBeEmptyDOMElement()
  })
})
