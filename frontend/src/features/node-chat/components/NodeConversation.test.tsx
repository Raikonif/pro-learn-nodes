import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { useProjectsUi } from '../../projects'
import { useAgentsStore } from '../../settings'

import NodeConversation from './NodeConversation'

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  // Agents already read, so the header does not fetch them mid-test.
  useAgentsStore.setState({ agents: [], presets: [], status: 'ready', error: null })
  __resetIdCounter()
  // jsdom does not implement scrollIntoView; the back-link calls it optionally.
  Element.prototype.scrollIntoView = vi.fn()
})

function openConversation(nodeId: string) {
  useWorkspaceStore.getState().openNode(nodeId)
  return render(<NodeConversation />)
}

describe('NodeConversation', () => {
  it('opens a node on its main thread', () => {
    openConversation('n-haskell')

    expect(screen.getByRole('heading', { name: 'Haskell' })).toBeInTheDocument()
    expect(useWorkspaceStore.getState().openThreadId).toBe('t-haskell-main')
    expect(screen.getByText(/Haskell defers evaluation/)).toBeInTheDocument()
    // Messages from a spawned thread stay out of the center until expanded.
    expect(screen.queryByText(/what exactly is a thunk/)).not.toBeInTheDocument()
  })

  it('names the session\'s project in the header and opens its instructions', async () => {
    let id = ''
    await act(async () => {
      id = await useWorkspaceStore.getState().createProject('Algebra')
      await useWorkspaceStore.getState().moveNodeToProject('n-haskell', id)
    })
    openConversation('n-haskell')

    fireEvent.click(screen.getByRole('button', { name: 'Project Algebra: show instructions' }))

    expect(useProjectsUi.getState().dialog).toEqual({ kind: 'instructions', projectId: id })
  })

  it('shows the project of the session that is open, not of one it links to', () => {
    openConversation('n-functors')

    expect(screen.getByTestId('session-project-link')).toHaveTextContent('General')
  })

  it('shows no project for a session whose project is not known', () => {
    useWorkspaceStore.setState((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) => (n.id === 'n-haskell' ? { ...n, projectId: null } : n)),
      },
    }))
    openConversation('n-haskell')

    expect(screen.queryByTestId('session-project-link')).not.toBeInTheDocument()
  })

  it('offers no delete action on the main thread', () => {
    openConversation('n-haskell')

    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument()
  })

  it('renders no per-thread mode, skills or MCP control', () => {
    openConversation('n-haskell')

    // The node's mode is shown, but only as text — threads inherit it.
    expect(screen.getByText('Deepen')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /mode|skill|mcp/i }),
    ).not.toBeInTheDocument()
  })

  it('renders a stub at the anchor showing the thread name and message count', () => {
    openConversation('n-haskell')

    const stub = screen.getByRole('button', { name: /Open thread "thunks"/ })
    expect(stub).toHaveAccessibleName('Open thread "thunks" (2 messages)')
    // The stub sits with the message it was anchored in, not at the end.
    const message = screen.getByText(/Haskell defers evaluation/)
    expect(message.parentElement).toContainElement(stub)
  })

  it('tracks the thread message count as messages are added', () => {
    openConversation('n-haskell')
    expect(screen.getByRole('button', { name: /Open thread "thunks"/ })).toHaveAccessibleName(
      'Open thread "thunks" (2 messages)',
    )

    const { graph } = useWorkspaceStore.getState()
    // A store write outside an event handler needs act() for React 19 to
    // flush it before the assertion reads the DOM.
    act(() => {
      useWorkspaceStore.setState({
        graph: {
          ...graph,
          messages: [
            ...graph.messages,
            {
              id: 'm-th-3',
              threadId: 't-haskell-thunks',
              role: 'learner',
              content: 'And when is it forced?',
              createdAt: '2026-08-12T14:01:00.000Z',
              kind: 'message',
              outcome: null,
            },
          ],
        },
      })
    })

    expect(screen.getByRole('button', { name: /Open thread "thunks"/ })).toHaveAccessibleName(
      'Open thread "thunks" (3 messages)',
    )
  })

  it('expands a thread in place of its source and keeps the stub reachable', () => {
    openConversation('n-haskell')

    fireEvent.click(screen.getByRole('button', { name: /Open thread "thunks"/ }))

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-haskell-thunks')
    expect(screen.getByText(/A thunk is a suspended computation/)).toBeInTheDocument()
    expect(screen.queryByText(/Haskell defers evaluation/)).not.toBeInTheDocument()
    // Still the same node — expanding a thread never changes what is open.
    expect(useWorkspaceStore.getState().openNodeId).toBe('n-haskell')
    // The nested thread's own stub is now visible inside the expanded thread.
    expect(
      screen.getByRole('button', { name: /Open thread "evaluated at most once"/ }),
    ).toBeInTheDocument()
  })

  it('returns to the source thread and scrolls to the anchor from the back-link', async () => {
    openConversation('n-haskell')
    fireEvent.click(screen.getByRole('button', { name: /Open thread "thunks"/ }))

    const backLink = screen.getByRole('button', { name: /^Back to the source thread/ })
    expect(backLink).toHaveAccessibleName(
      'Back to the source thread — from: thunks on the heap',
    )
    fireEvent.click(backLink)

    expect(useWorkspaceStore.getState().openThreadId).toBe('t-haskell-main')
    expect(screen.getByText(/Haskell defers evaluation/)).toBeInTheDocument()
    // The stub survived the round trip and is what we scrolled back to.
    expect(screen.getByRole('button', { name: /Open thread "thunks"/ })).toBeInTheDocument()
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('shows no back-link on a main thread', () => {
    openConversation('n-haskell')

    expect(
      screen.queryByRole('button', { name: /^Back to the source thread/ }),
    ).not.toBeInTheDocument()
  })

  it('renders a stale stub from its stored excerpt and keeps it reachable', () => {
    openConversation('n-functors')

    const stub = screen.getByRole('button', { name: /Open thread "which laws exactly"/ })
    expect(stub).toBeVisible()
    expect(stub.getAttribute('aria-label')).toMatch(/stale/i)
    expect(within(stub).getByText('stale')).toBeInTheDocument()
    expect(stub).toHaveAttribute(
      'title',
      'Stale anchor — stored text: "preserving structure and the functor laws"',
    )
    expect(within(stub).getByText(/preserving structure and the functor laws/)).toBeInTheDocument()

    // Still activatable — a failed anchor never costs the learner the thread.
    fireEvent.click(stub)
    expect(useWorkspaceStore.getState().openThreadId).toBe('t-functors-laws')
    expect(screen.getByText(/Which laws are we actually talking about/)).toBeInTheDocument()
  })

  it('prompts to open a node when nothing is open', () => {
    render(<NodeConversation />)

    expect(screen.getByText('Open a node to start a conversation.')).toBeInTheDocument()
  })
})

describe('NodeConversation — arriving from the session history', () => {
  it('scrolls a revealed message into view and highlights it briefly', async () => {
    vi.useFakeTimers()
    try {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      await useWorkspaceStore.getState().openSessionAt('n-haskell', 't-haskell-once', 'm-on-2')

      const { container } = render(<NodeConversation />)

      const message = container.querySelector('[data-message-id="m-on-2"]')!
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(scroll.mock.contexts[0]).toBe(message)
      expect(message).toHaveAttribute('data-highlighted', 'true')
      // Consumed, so a later re-render does not scroll the learner back.
      expect(useWorkspaceStore.getState().revealedMessageId).toBeNull()

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(message).not.toHaveAttribute('data-highlighted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reveals nothing when opened without a message', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await useWorkspaceStore.getState().openSessionAt('n-haskell', null, null)

    const { container } = render(<NodeConversation />)

    expect(scroll).not.toHaveBeenCalled()
    expect(container.querySelector('[data-highlighted]')).toBeNull()
  })

  it('focuses the composer of a session that was just created, once', () => {
    act(() => {
      useWorkspaceStore.getState().createRootNode()
    })

    render(<NodeConversation />)

    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
    expect(useWorkspaceStore.getState().composerFocusRequested).toBe(false)
  })

  it('does not take focus when an existing node is opened', () => {
    openConversation('n-haskell')

    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus()
  })
})
