import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { useMemoryStore } from '../features/memory'
import { useAgentsStore } from '../features/settings'
import { usePaneLayout } from '../shared/lib/pane-layout'
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
  usePaneLayout.getState().reset()
  try {
    window.localStorage.clear()
  } catch {
    // Storage is optional; the layout falls back to its defaults without it.
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Answers the practice read for the Haskell node with one delivered quiz, so
 * the workbench has a block; every other request stays pending, as above.
 */
function withDeliveredQuiz() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      if (!String(input).includes('/practice/nodes/n-haskell')) return new Promise<Response>(() => {})
      const body = {
        nodeId: 'n-haskell',
        items: [
          {
            id: 'q-1',
            nodeId: 'n-haskell',
            kind: 'multiple_choice',
            prompt: 'Is Haskell lazy?',
            options: [
              { text: 'Yes', correct: true },
              { text: 'No', correct: false },
            ],
            referenceAnswer: null,
            createdAt: '2026-10-01T10:00:00Z',
            starterCode: null,
            expectedOutput: null,
            authoredBy: { agentId: 'a-1', name: 'Codex' },
            deliveryId: 'd-1',
          },
        ],
        attempts: [],
        sandbox: { code: '', updatedAt: null },
      }
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }))
    }),
  )
}

/**
 * The quiz block's header. The practice store outlives a test, so a block
 * collapsed by an earlier test may start collapsed here: each test expands it
 * itself rather than relying on the default.
 */
function quizHeader(): HTMLElement {
  const block = within(screen.getByTestId('right-rail-tools')).getByTestId('practice-block')
  const header = within(block).getAllByRole('button')[0]
  if (header.getAttribute('aria-expanded') !== 'true') fireEvent.click(header)
  return header
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

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

  it('uses Tailwind utility classes, the only inline style being each rail width property', () => {
    const { container } = render(<Workspace />)
    // React Flow necessarily uses inline transforms and dimensions inside its
    // graph surface. The workspace shell itself remains utility-class styled.
    expect(container.querySelectorAll('header[style], [data-testid="center-region"][style]')).toHaveLength(0)

    // A dragged width cannot be a fixed utility class, so each rail carries
    // exactly one CSS custom property and nothing else (node-workspace-layout).
    const { left, right } = panes()
    expect(left.getAttribute('style')).toMatch(/^--left-rail: \d+px;?$/)
    expect(right.getAttribute('style')).toMatch(/^--right-rail: \d+px;?$/)
    expect(left).toHaveClass('w-[var(--left-rail)]')
    expect(right).toHaveClass('w-[var(--right-rail)]')
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

  it('gives an expanded practice block the height, keeping the minimap as its breadcrumb', async () => {
    // The minimap is stacked above the workbench rather than being one of its
    // blocks precisely so this holds: working on a block never costs you your
    // position in the graph, only the space the map takes.
    withDeliveredQuiz()
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<Workspace />)
    await settle()

    const header = quizHeader()
    expect(within(screen.getByTestId('right-rail-map')).getByTestId('graph-breadcrumb')).toBeInTheDocument()

    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByTestId('right-rail-map')).getByTestId('graph-minimap')).toBeInTheDocument()
  })

  it('expanding a practice block leaves the center and the left rail unchanged', async () => {
    withDeliveredQuiz()
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<Workspace />)
    await settle()
    const header = quizHeader()
    const { left, center } = panes()
    const before = [left.innerHTML, center.innerHTML]

    fireEvent.click(header)
    fireEvent.click(header)

    expect([left.innerHTML, center.innerHTML]).toEqual(before)
  })

  it('renders no practice tools or content with no node open, and removes them on close', () => {
    render(<Workspace />)
    const right = panes().right

    expect(within(right).queryByTestId('practice-rail')).not.toBeInTheDocument()
    expect(within(right).queryAllByTestId('practice-block')).toHaveLength(0)

    act(() => useWorkspaceStore.getState().openNode('n-haskell'))
    expect(within(right).getByTestId('practice-rail')).toBeInTheDocument()

    act(() => useWorkspaceStore.getState().closeNode())
    expect(within(right).queryByTestId('practice-rail')).not.toBeInTheDocument()
    expect(within(right).queryAllByTestId('practice-block')).toHaveLength(0)
    expect(right).toBeEmptyDOMElement()
  })
})

describe('Workspace — starting sessions', () => {
  function emptyAccount(): void {
    useWorkspaceStore.setState({ graph: { nodes: [], links: [], threads: [], messages: [], projects: [], archivedLinks: [] } })
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

describe('Workspace — resizable rails', () => {
  function railWidth(rail: HTMLElement, property: '--left-rail' | '--right-rail'): string {
    return rail.style.getPropertyValue(property)
  }

  it('sizes the rails at their default widths', () => {
    render(<Workspace />)
    const { left, right } = panes()

    expect(railWidth(left, '--left-rail')).toBe('240px')
    expect(railWidth(right, '--right-rail')).toBe('320px')
  })

  it('puts a resize edge on the inner edge of each rail', () => {
    render(<Workspace />)

    const leftEdge = screen.getByRole('separator', { name: 'Resize node index' })
    const rightEdge = screen.getByRole('separator', { name: 'Resize workspace tools' })
    expect(leftEdge).toHaveAttribute('aria-valuenow', '240')
    expect(rightEdge).toHaveAttribute('aria-valuenow', '320')
    // Left rail, its edge, the center, the right rail's edge, the right rail.
    expect(leftEdge.previousElementSibling).toBe(panes().left)
    expect(rightEdge.nextElementSibling).toBe(panes().right)
  })

  it('widens the right rail from the keyboard and remembers it', () => {
    render(<Workspace />)

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize workspace tools' }), { key: 'ArrowLeft' })

    expect(railWidth(panes().right, '--right-rail')).toBe('336px')
    expect(usePaneLayout.getState().right.width).toBe(336)
  })

  it('restores a rail default on double-click of its edge', () => {
    usePaneLayout.getState().setWidth('left', 400)
    render(<Workspace />)

    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize node index' }))

    expect(railWidth(panes().left, '--left-rail')).toBe('240px')
  })

  it('suppresses text selection in the workspace while an edge is dragged', () => {
    const { container } = render(<Workspace />)
    const shell = container.firstElementChild as HTMLElement
    const edge = screen.getByRole('separator', { name: 'Resize node index' })

    fireEvent.pointerDown(edge, { clientX: 240, pointerId: 1, button: 0 })
    expect(shell).toHaveClass('select-none')
    fireEvent.pointerUp(edge, { clientX: 240, pointerId: 1 })
    expect(shell).not.toHaveClass('select-none')
  })

  it('clamps the rendered widths to the window without rewriting the stored ones', () => {
    usePaneLayout.getState().setWidth('left', 400, 2000)
    usePaneLayout.getState().setWidth('right', 600, 2000)
    vi.stubGlobal('innerWidth', 2000)
    render(<Workspace />)
    expect(railWidth(panes().left, '--left-rail')).toBe('400px')
    expect(railWidth(panes().right, '--right-rail')).toBe('600px')

    act(() => {
      vi.stubGlobal('innerWidth', 800)
      window.dispatchEvent(new Event('resize'))
    })

    expect(railWidth(panes().left, '--left-rail')).toBe('180px')
    expect(railWidth(panes().right, '--right-rail')).toBe('240px')
    expect(usePaneLayout.getState().left.width).toBe(400)
    expect(usePaneLayout.getState().right.width).toBe(600)

    act(() => {
      vi.stubGlobal('innerWidth', 2000)
      window.dispatchEvent(new Event('resize'))
    })
    expect(railWidth(panes().right, '--right-rail')).toBe('600px')
  })

  it('limits a drag so the center keeps its minimum width', () => {
    vi.stubGlobal('innerWidth', 1000)
    render(<Workspace />)

    // 1000 - 380 (center) - 240 (left) = 380 at most for the right rail.
    expect(screen.getByRole('separator', { name: 'Resize workspace tools' })).toHaveAttribute(
      'aria-valuemax',
      '380',
    )
  })
})

describe('Workspace — collapsing rails', () => {
  it('collapses the left rail to a strip from the header and expands it again at its width', () => {
    usePaneLayout.getState().setWidth('left', 300)
    render(<Workspace />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse node index' }))

    expect(panes().left).not.toBeVisible()
    expect(screen.queryByRole('separator', { name: 'Resize node index' })).not.toBeInTheDocument()
    const strip = screen.getByRole('button', { name: 'Show node index' })
    expect(strip).toHaveClass('w-7')

    fireEvent.click(strip)

    expect(panes().left).toBeVisible()
    expect(panes().left.style.getPropertyValue('--left-rail')).toBe('300px')
    expect(screen.getByRole('button', { name: 'Collapse node index' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps a search in progress across collapsing the left rail', () => {
    render(<Workspace />)
    const search = within(panes().left).getByLabelText('Search sessions')
    fireEvent.change(search, { target: { value: 'lazy' } })

    fireEvent.click(screen.getByRole('button', { name: 'Collapse node index' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand node index' }))

    expect(within(panes().left).getByLabelText('Search sessions')).toHaveValue('lazy')
  })

  it('keeps the open node and the expanded practice block across collapsing the right rail', async () => {
    withDeliveredQuiz()
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<Workspace />)
    await settle()
    const expandedName = quizHeader().textContent

    fireEvent.click(screen.getByRole('button', { name: 'Collapse workspace tools' }))
    expect(panes().right).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Show workspace tools' })).toBeInTheDocument()
    // The conversation is unaffected by the rail going away.
    expect(within(panes().center).getByText('Explain lazy evaluation.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand workspace tools' }))

    expect(useWorkspaceStore.getState().openNodeId).toBe('n-haskell')
    expect(
      within(screen.getByTestId('right-rail-tools')).getByRole('button', { expanded: true }),
    ).toHaveTextContent(expandedName ?? '')
  })

  it('remembers a collapsed rail', () => {
    usePaneLayout.getState().setCollapsed('right', true)
    render(<Workspace />)

    expect(panes().right).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Expand workspace tools' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('Workspace — command palette', () => {
  function openPalette(): void {
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
  }

  it('is an overlay above the three panes: their content is kept while it is open and after it closes', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<Workspace />)
    const { left, center, right } = panes()
    const before = [left.innerHTML, center.innerHTML, right.innerHTML]
    const regions = screen.getAllByRole('main').length + screen.getAllByRole('complementary').length

    openPalette()
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })

    // Over the panes, not among them: still the same panes, in the same
    // places, holding the same content, and no region was added.
    expect(dialog.closest('[data-testid="center-region"], aside')).toBeNull()
    expect(panes()).toEqual({ left, center, right })
    expect([left.innerHTML, center.innerHTML, right.innerHTML]).toEqual(before)
    expect(screen.getAllByRole('main').length + screen.getAllByRole('complementary').length).toBe(regions)

    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect([left.innerHTML, center.innerHTML, right.innerHTML]).toEqual(before)
  })

  it('is a fixed, height-bounded overlay with its own scroll, so it never reflows a pane at 800x600', () => {
    // jsdom performs no layout; this asserts the classes that guarantee it.
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 600)
    render(<Workspace />)

    openPalette()

    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(screen.getByTestId('command-palette-backdrop')).toHaveClass('fixed', 'inset-0')
    expect(dialog.className).toMatch(/max-h-/)
    expect(within(dialog).getByRole('listbox').parentElement).toHaveClass('overflow-y-auto')
  })

  it('leaves the left rail search to nodes: the palette does not add commands to it', () => {
    render(<Workspace />)
    openPalette()
    fireEvent.change(screen.getByRole('combobox', { name: 'Search commands and nodes' }), { target: { value: 'haskell' } })

    expect(within(panes().left).queryByRole('option', { name: 'Haskell' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('option', { name: 'Haskell' })).toBeInTheDocument()
  })

  it('opens "Start with a topic…" from the palette as the one dialog, and the button still opens it', async () => {
    render(<Workspace />)

    openPalette()
    fireEvent.change(screen.getByRole('combobox', { name: 'Search commands and nodes' }), { target: { value: 'start with a topic' } })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search commands and nodes' }), { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: 'Start a session' })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog', { name: 'Start a session' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Start a session' })).not.toBeInTheDocument()

    // With sessions in the account the button is not on screen; the empty
    // workspace shows it, and it must still open exactly one dialog.
    act(() => useWorkspaceStore.setState({ graph: { nodes: [], links: [], threads: [], messages: [], projects: [], archivedLinks: [] } }))
    fireEvent.click(within(panes().center).getByRole('button', { name: 'Start with a topic…' }))
    expect(screen.getAllByRole('dialog', { name: 'Start a session' })).toHaveLength(1)
  })
})

describe('Workspace — projects', () => {
  it('edits a project\'s instructions with a node open: still three panes, conversation stays', async () => {
    let id = ''
    await act(async () => {
      id = await useWorkspaceStore.getState().createProject('Algebra')
      await useWorkspaceStore.getState().moveNodeToProject('n-haskell', id)
    })
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<Workspace />)
    const { left, center, right } = panes()
    const regions = screen.getAllByRole('main').length + screen.getAllByRole('complementary').length

    fireEvent.click(screen.getByRole('button', { name: 'Project Algebra: show instructions' }))
    const dialog = screen.getByRole('dialog', { name: 'Instructions for Algebra' })

    // Over the panes, not among them.
    expect(dialog.closest('[data-testid="center-region"], aside')).toBeNull()
    expect(panes()).toEqual({ left, center, right })
    expect(screen.getAllByRole('main').length + screen.getAllByRole('complementary').length).toBe(regions)
    expect(within(center).getByRole('heading', { name: 'Haskell' })).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Instructions'), { target: { value: 'Use Lean.' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    })

    expect(screen.queryByRole('dialog', { name: 'Instructions for Algebra' })).not.toBeInTheDocument()
    expect(useWorkspaceStore.getState().graph.projects.find((p) => p.id === id)!.instructions).toBe('Use Lean.')
    expect(useWorkspaceStore.getState().openNodeId).toBe('n-haskell')
  })

  it('opens "New project" from the palette as the one dialog', async () => {
    render(<Workspace />)

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const input = await screen.findByRole('combobox', { name: 'Search commands and nodes' })
    fireEvent.change(input, { target: { value: 'new project' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog', { name: 'New project' })).toHaveLength(1)
  })
})
