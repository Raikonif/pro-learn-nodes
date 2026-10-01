import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { useMemoryStore } from '../features/memory'
import { useAgentsStore } from '../features/settings'
import { __resetIdCounter, useWorkspaceStore } from '../shared/lib/workspace-store'

import Workspace from './Workspace'

beforeEach(() => {
  // The chrome's health probe must never make the suite depend on a backend.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  )
  __resetIdCounter()
  useWorkspaceStore.getState().reset()
  useAgentsStore.getState().discard()
  useMemoryStore.getState().discard()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function panes() {
  return {
    left: screen.getByTestId('left-rail'),
    center: screen.getByTestId('center-region'),
    right: screen.getByTestId('right-rail'),
  }
}

describe('Workspace — three panes', () => {
  it('renders a left rail, a center region, and a right rail', () => {
    render(<Workspace />)
    const { left, center, right } = panes()

    expect(left).toBeInTheDocument()
    expect(center).toBeInTheDocument()
    expect(right).toBeInTheDocument()
  })

  it('keeps all three panes present at 800x600', () => {
    // jsdom performs no layout, so this cannot assert visual legibility — it
    // asserts the weaker, still-useful thing: nothing is conditionally
    // dropped at the minimum supported window size. Real legibility at
    // 800x600 is covered by the Playwright suite.
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 600)
    render(<Workspace />)
    const { left, center, right } = panes()

    expect(left).toBeInTheDocument()
    expect(center).toBeInTheDocument()
    expect(right).toBeInTheDocument()
  })

  it('opens agent settings from the chrome, as a dialog rather than a fourth pane', () => {
    render(<Workspace />)

    fireEvent.click(screen.getByRole('button', { name: 'Agent settings' }))

    expect(screen.getByRole('dialog', { name: 'Agents' })).toBeInTheDocument()
    const { left, center, right } = panes()
    expect(left).toBeInTheDocument()
    expect(center).toBeInTheDocument()
    expect(right).toBeInTheDocument()
  })

  it('opens memory from the chrome, beside agent settings, as a dialog', () => {
    render(<Workspace />)

    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))

    expect(screen.getByRole('dialog', { name: 'Memory' })).toBeInTheDocument()
    const { left, center, right } = panes()
    expect(left).toBeInTheDocument()
    expect(center).toBeInTheDocument()
    expect(right).toBeInTheDocument()
  })

  it('shows the backend status indicator in the chrome', () => {
    render(<Workspace />)
    expect(screen.getByText('Backend offline')).toBeInTheDocument()
  })

  it('uses Tailwind utility classes rather than inline styles', () => {
    const { container } = render(<Workspace />)
    const styledShellElements = container.querySelectorAll(
      'header[style], [data-testid="left-rail"][style], [data-testid="center-region"][style], [data-testid="right-rail"][style]',
    )
    // React Flow necessarily uses inline transforms and dimensions inside its
    // graph surface. The workspace shell itself remains utility-class styled.
    expect(styledShellElements).toHaveLength(0)
  })
})

describe('Workspace — idle state', () => {
  it('renders the graph in the center when no node is open', () => {
    render(<Workspace />)
    const { center } = panes()

    expect(within(center).getByRole('button', { name: 'Haskell' })).toBeInTheDocument()
  })

  it('renders no minimap when no node is open', () => {
    render(<Workspace />)
    expect(screen.queryByTestId('right-rail-map')).not.toBeInTheDocument()
  })
})

describe('Workspace — entering and leaving a node', () => {
  it('moves the conversation into the center and the graph into the right rail', () => {
    render(<Workspace />)

    fireEvent.click(within(panes().center).getByRole('button', { name: 'Haskell' }))

    expect(useWorkspaceStore.getState().openNodeId).toBe('n-haskell')
    // The graph left the center...
    expect(screen.getByTestId('right-rail-map')).toBeInTheDocument()
    // ...and the conversation took it. Assert on a message rather than the
    // node title, which also appears in the rail and the minimap.
    expect(
      within(screen.getByTestId('center-region')).getByText('Explain lazy evaluation.'),
    ).toBeInTheDocument()
  })

  it('restores the graph to the center and removes the minimap on close', () => {
    render(<Workspace />)

    // `act` because these drive the store from outside React; without it the
    // re-render has not flushed when the assertions run.
    act(() => useWorkspaceStore.getState().openNode('n-haskell'))
    expect(screen.getByTestId('right-rail-map')).toBeInTheDocument()

    act(() => useWorkspaceStore.getState().closeNode())

    expect(screen.queryByTestId('right-rail-map')).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('center-region')).getByRole('button', { name: 'Haskell' }),
    ).toBeInTheDocument()
  })

  it('renders the practice tools below the minimap while a node is open', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<Workspace />)

    expect(screen.getByTestId('right-rail-map')).toBeInTheDocument()
    expect(screen.getByTestId('right-rail-tools')).toBeInTheDocument()
  })

  it('creates and opens a child from a center-card plus control', () => {
    render(<Workspace />)

    const center = panes().center
    const parentCard = within(center).getByRole('button', { name: 'Haskell' })
    fireEvent.click(
      within(parentCard).getByRole('button', {
        name: 'Create child node from Haskell',
      }),
    )

    const state = useWorkspaceStore.getState()
    const child = state.graph.nodes[state.graph.nodes.length - 1]
    const childLink = state.graph.links.find((link) => link.childId === child.id)
    const childMainThread = state.graph.threads.find(
      (thread) => thread.nodeId === child.id && thread.anchor === null,
    )

    expect(state.openNodeId).toBe(child.id)
    expect(childMainThread).toBeDefined()
    expect(state.openThreadId).toBe(childMainThread?.id)
    expect(childLink).toMatchObject({ parentId: 'n-haskell', anchor: null })
    expect(within(panes().left).getByRole('button', { name: child.title })).toBeInTheDocument()
    expect(within(panes().center).getByRole('heading', { name: child.title })).toBeInTheDocument()
    expect(screen.getByTestId('right-rail-map')).toBeInTheDocument()
  })

  it('keeps the minimap visible when a practice tool is selected', () => {
    // The minimap is stacked above the tools rather than being a peer tab
    // precisely so this holds: picking a tool must never cost you your
    // position in the graph.
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<Workspace />)

    const tools = screen.getByTestId('right-rail-tools')
    const tabs = within(tools).getAllByRole('tab')
    expect(tabs.length).toBeGreaterThan(1)

    for (const tab of tabs) {
      fireEvent.click(tab)
      expect(screen.getByTestId('right-rail-map')).toBeInTheDocument()
    }
  })

  it('selecting a practice tool leaves the minimap, the center and the left rail unchanged', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<Workspace />)
    const { left, center } = panes()
    const map = screen.getByTestId('right-rail-map')
    const before = [left.innerHTML, center.innerHTML, map.innerHTML]

    for (const tab of within(screen.getByTestId('right-rail-tools')).getAllByRole('tab')) {
      fireEvent.click(tab)
      expect([left.innerHTML, center.innerHTML, map.innerHTML]).toEqual(before)
    }
  })

  it('renders no practice tools or content with no node open, and removes them on close', () => {
    render(<Workspace />)
    const right = panes().right

    expect(within(right).queryByTestId('practice-rail')).not.toBeInTheDocument()
    expect(within(right).queryAllByRole('tab')).toHaveLength(0)

    act(() => useWorkspaceStore.getState().openNode('n-haskell'))
    expect(within(right).getByTestId('practice-rail')).toBeInTheDocument()

    act(() => useWorkspaceStore.getState().closeNode())
    expect(within(right).queryByTestId('practice-rail')).not.toBeInTheDocument()
    expect(within(right).queryAllByRole('tab')).toHaveLength(0)
    expect(right).toBeEmptyDOMElement()
  })
})

describe('Workspace — starting sessions', () => {
  function emptyAccount(): void {
    useWorkspaceStore.setState({ graph: { nodes: [], links: [], threads: [], messages: [] } })
  }

  it('offers both starts in place of the graph when the account has no sessions', () => {
    emptyAccount()
    render(<Workspace />)
    const { center } = panes()

    expect(within(center).getByRole('button', { name: 'Start a new session' })).toBeInTheDocument()
    expect(within(center).getByRole('button', { name: 'Start with a topic…' })).toBeInTheDocument()
    expect(within(center).queryByTestId('graph-canvas')).not.toBeInTheDocument()
  })

  it('renders the graph, not the starts, once the account has a session', () => {
    render(<Workspace />)
    const { center } = panes()

    expect(within(center).getByTestId('graph-canvas')).toBeInTheDocument()
    expect(within(center).queryByTestId('empty-workspace-start')).not.toBeInTheDocument()
  })

  it('starts a first session from the empty workspace, opened and ready to write', async () => {
    emptyAccount()
    render(<Workspace />)

    await act(async () => {
      fireEvent.click(within(panes().center).getByRole('button', { name: 'Start a new session' }))
    })

    const center = panes().center
    expect(within(center).getByRole('heading', { name: 'New session' })).toBeInTheDocument()
    expect(within(center).getByRole('textbox', { name: 'Message' })).toHaveFocus()
    // The history lists it under its provisional title, beside the quick start.
    expect(within(panes().left).getByRole('button', { name: 'New session' })).toBeInTheDocument()
    expect(within(panes().left).getByRole('button', { name: 'Start a new session' })).toBeInTheDocument()
  })

  it('keeps a quick start in the left-rail header while sessions exist', async () => {
    render(<Workspace />)
    const before = useWorkspaceStore.getState().graph.nodes.length

    await act(async () => {
      fireEvent.click(within(panes().left).getByRole('button', { name: 'Start a new session' }))
    })

    const state = useWorkspaceStore.getState()
    expect(state.graph.nodes).toHaveLength(before + 1)
    expect(within(panes().center).getByRole('textbox', { name: 'Message' })).toHaveFocus()
  })

  it('archiving from the history takes the session off the graph as well', () => {
    render(<Workspace />)

    fireEvent.click(within(panes().left).getByRole('button', { name: 'Archive Category Theory' }))

    expect(within(panes().center).queryByRole('button', { name: 'Category Theory' })).not.toBeInTheDocument()
    expect(within(panes().left).queryByRole('button', { name: 'Category Theory' })).not.toBeInTheDocument()
  })
})
