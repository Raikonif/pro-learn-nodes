import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { useAgentsStore } from '../../settings'
import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import RecentsRail, { SEARCH_DEBOUNCE_MS } from './RecentsRail'

const CODEX = {
  id: 'agent-codex',
  name: 'Codex',
  command: 'codex-acp',
  args: [],
  env: {},
  isDefault: true,
}

// One test replaces this action with a failing stub; every test starts from the real one.
const archiveNode = useWorkspaceStore.getState().archiveNode

beforeEach(() => {
  cleanup()
  __resetIdCounter()
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.setState({ archiveNode })
  // Agents already read, so the rail does not fetch them mid-test.
  useAgentsStore.setState({ agents: [CODEX], presets: [], status: 'ready', error: null })
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** The session each history entry opens, in the order the rail shows them. */
function entryTitles(): string[] {
  return screen
    .queryAllByTestId('session-entry')
    .map((entry) => within(entry).getAllByRole('button')[0].getAttribute('aria-label') ?? '')
}

function entryFor(title: string): HTMLElement {
  const entry = screen
    .getAllByTestId('session-entry')
    .find((candidate) => within(candidate).queryByRole('button', { name: title }))
  if (!entry) throw new Error(`No history entry for ${title}`)
  return entry
}

function setNode(id: string, patch: Record<string, unknown>): void {
  useWorkspaceStore.setState((state) => ({
    graph: {
      ...state.graph,
      nodes: state.graph.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    },
  }))
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

describe('RecentsRail — the session history', () => {
  it('lists sessions by last activity, most recent first', () => {
    render(<RecentsRail />)

    // Fixture `lastActivityAt` ordering.
    expect(entryTitles()).toEqual([
      'Functors',
      'Haskell',
      'Category Theory',
      'Lazy Evaluation',
      'Functional Programming',
    ])
  })

  it('groups sessions under Today, Yesterday, Previous 7 days and Older', () => {
    setNode('n-haskell', { lastActivityAt: new Date().toISOString() })
    setNode('n-cat', { lastActivityAt: daysAgo(1) })
    setNode('n-functors', { lastActivityAt: daysAgo(4) })
    setNode('n-fp', { lastActivityAt: daysAgo(30) })
    setNode('n-lazy-evaluation', { lastActivityAt: daysAgo(40) })
    render(<RecentsRail />)

    const groups = screen.getAllByRole('region')
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 days',
      'Older',
    ])
    expect(within(groups[0]).getByRole('button', { name: 'Haskell' })).toBeInTheDocument()
    expect(within(groups[1]).getByRole('button', { name: 'Category Theory' })).toBeInTheDocument()
    expect(within(groups[2]).getByRole('button', { name: 'Functors' })).toBeInTheDocument()
    expect(entryTitles().slice(3)).toEqual(['Functional Programming', 'Lazy Evaluation'])
  })

  it('shows no heading for an empty group', () => {
    render(<RecentsRail />)

    // Every fixture session is weeks old.
    expect(screen.getAllByRole('region').map((group) => group.getAttribute('aria-label'))).toEqual([
      'Older',
    ])
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('opens a node when its entry is activated', () => {
    render(<RecentsRail />)

    fireEvent.click(screen.getByRole('button', { name: 'Category Theory' }))

    expect(useWorkspaceStore.getState().openNodeId).toBe('n-cat')
    expect(useWorkspaceStore.getState().openThreadId).toBe('t-cat-main')
  })

  it('reorders after opening, so the newly opened node leads', () => {
    render(<RecentsRail />)

    fireEvent.click(screen.getByRole('button', { name: 'Functional Programming' }))

    expect(entryTitles()[0]).toBe('Functional Programming')
    expect(screen.getAllByRole('region')[0]).toHaveAccessibleName('Today')
  })

  it('previews the beginning of the most recent message, from any thread', () => {
    render(<RecentsRail />)

    // Haskell's newest message is in a nested spawned thread.
    expect(within(entryFor('Haskell')).getByTestId('session-preview')).toHaveTextContent(
      /^The runtime overwrites the thunk in place/,
    )
    expect(within(entryFor('Haskell')).getByTestId('session-preview').textContent!.length).toBeLessThanOrEqual(81)
    expect(screen.getByRole('button', { name: 'Haskell' })).toHaveAccessibleDescription(
      /The runtime overwrites/,
    )
  })

  it('names the agent a session last ran on, and nothing when it has none', () => {
    setNode('n-haskell', { backendAgentId: 'agent-codex' })
    setNode('n-cat', { backendAgentId: 'agent-removed' })
    render(<RecentsRail />)

    expect(within(entryFor('Haskell')).getByTestId('session-agent')).toHaveTextContent('Codex')
    // An agent no longer registered, or none at all, shows no name.
    expect(within(entryFor('Category Theory')).queryByTestId('session-agent')).not.toBeInTheDocument()
    expect(within(entryFor('Functors')).queryByTestId('session-agent')).not.toBeInTheDocument()
  })

  it('loads the registered agents when they have not been read yet', () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    useAgentsStore.getState().discard()

    render(<RecentsRail />)

    expect(fetchMock).toHaveBeenCalledWith('/api/agents', expect.objectContaining({ method: 'GET' }))
  })

  it('never lists spawned threads', () => {
    render(<RecentsRail />)

    // These threads exist in the fixture on Haskell and Functors; the rail
    // indexes nodes only.
    for (const threadName of ['thunks', 'evaluated at most once', 'which laws exactly']) {
      expect(screen.queryByText(threadName)).not.toBeInTheDocument()
    }
    expect(screen.queryByText('main')).not.toBeInTheDocument()
    expect(entryTitles()).toHaveLength(useWorkspaceStore.getState().graph.nodes.length)
  })

  it('does not list threads created after the first render either', () => {
    render(<RecentsRail />)
    const before = entryTitles().length

    const anchor = {
      messageId: 'm-hs-2',
      start: 0,
      end: 7,
      excerpt: 'Haskell',
    }
    act(() => {
      useWorkspaceStore.getState().createThreadFrom('n-haskell', anchor, 'a brand new thread')
    })

    expect(screen.queryByText('a brand new thread')).not.toBeInTheDocument()
    expect(entryTitles()).toHaveLength(before)
  })

  it('marks the open node as current', () => {
    render(<RecentsRail />)

    fireEvent.click(screen.getByRole('button', { name: 'Haskell' }))

    expect(screen.getByRole('button', { name: 'Haskell' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Functors' })).not.toHaveAttribute('aria-current')
  })

  it('renders a control passed for its header', () => {
    render(<RecentsRail headerAction={<button type="button">New session</button>} />)

    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument()
  })

  it('says so when there are no sessions yet', () => {
    useWorkspaceStore.setState((state) => ({ graph: { ...state.graph, nodes: [] } }))
    render(<RecentsRail />)

    expect(screen.getByText('No sessions yet.')).toBeInTheDocument()
  })
})

describe('RecentsRail — archiving', () => {
  it('archives a session out of the history, and offers no delete', () => {
    render(<RecentsRail />)

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Archive Haskell' }))

    expect(entryTitles()).not.toContain('Haskell')
    // Its children stay.
    expect(entryTitles()).toEqual(
      expect.arrayContaining(['Functors', 'Lazy Evaluation']),
    )
    expect(useWorkspaceStore.getState().graph.nodes.some((n) => n.id === 'n-haskell')).toBe(false)
  })

  it('says why when archiving fails', async () => {
    useWorkspaceStore.setState({ archiveNode: () => Promise.reject(new Error('backend down')) })
    render(<RecentsRail />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive Haskell' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('backend down')
  })
})

describe('RecentsRail — renaming', () => {
  function startRename(title: string): HTMLInputElement {
    fireEvent.click(screen.getByRole('button', { name: `Rename ${title}` }))
    return screen.getByRole('textbox', { name: `Rename ${title}` }) as HTMLInputElement
  }

  it('renames inline: Enter saves the new title', async () => {
    render(<RecentsRail />)

    const input = startRename('Haskell')
    expect(input).toHaveFocus()
    expect(input).toHaveValue('Haskell')
    fireEvent.change(input, { target: { value: 'Laziness in Haskell' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    expect(screen.queryByRole('textbox', { name: /Rename/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Laziness in Haskell' })).toBeInTheDocument()
    expect(useWorkspaceStore.getState().graph.nodes.find((n) => n.id === 'n-haskell')).toMatchObject({
      title: 'Laziness in Haskell',
      titleSource: 'learner',
    })
  })

  it('Escape cancels without renaming', () => {
    render(<RecentsRail />)

    const input = startRename('Haskell')
    fireEvent.change(input, { target: { value: 'Something else' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('textbox', { name: /Rename/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Haskell' })).toBeInTheDocument()
  })

  it('leaving the field cancels too', () => {
    render(<RecentsRail />)

    const input = startRename('Haskell')
    fireEvent.change(input, { target: { value: 'Something else' } })
    fireEvent.blur(input)

    expect(screen.getByRole('button', { name: 'Haskell' })).toBeInTheDocument()
  })

  it('refuses an empty title and keeps editing', async () => {
    render(<RecentsRail />)

    const input = startRename('Haskell')
    fireEvent.change(input, { target: { value: '   ' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be empty/)
    expect(screen.getByRole('textbox', { name: 'Rename Haskell' })).toBeInTheDocument()
    expect(useWorkspaceStore.getState().graph.nodes.find((n) => n.id === 'n-haskell')?.title).toBe(
      'Haskell',
    )
  })

  it('starts a rename on double-clicking the title', () => {
    render(<RecentsRail />)

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Haskell' }))

    expect(screen.getByRole('textbox', { name: 'Rename Haskell' })).toBeInTheDocument()
  })
})

// ── Search ────────────────────────────────────────────────────────────────

type Result = {
  nodeId: string
  title: string
  archived: boolean
  threadId: string | null
  messageId: string | null
  snippet: string | null
  lastActivityAt: string
}

const THUNK_RESULT: Result = {
  nodeId: 'n-haskell',
  title: 'Haskell',
  archived: false,
  threadId: 't-haskell-once',
  messageId: 'm-on-2',
  snippet: 'The runtime overwrites the thunk in place',
  lastActivityAt: '2026-08-12T14:05:00.000Z',
}

const TITLE_RESULT: Result = {
  nodeId: 'n-cat',
  title: 'Category Theory',
  archived: false,
  threadId: null,
  messageId: null,
  snippet: null,
  lastActivityAt: '2026-08-10T16:20:00.000Z',
}

/**
 * Answers search requests with `answer(url)`. A plain object rather than a
 * `Response`, whose body streams would need real timers to drain.
 */
function stubSearch(answer: (url: URL) => Result[] | Error) {
  const fetchMock = vi.fn((input: unknown) => {
    const url = new URL(String(input), 'http://localhost')
    const results = answer(url)
    if (results instanceof Error) {
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: () => Promise.resolve({ detail: results.message }),
      } as Response)
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results }),
    } as Response)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function searchUrls(fetchMock: ReturnType<typeof stubSearch>): URL[] {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost'))
}

async function type(value: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value } })
}

/** Lets the debounce elapse and the answer settle. */
async function settle(ms = SEARCH_DEBOUNCE_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  for (let i = 0; i < 5; i += 1) await act(async () => {})
}

describe('RecentsRail — search', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  it('queries the index once typing pauses, not on every keystroke', async () => {
    const fetchMock = stubSearch(() => [THUNK_RESULT])
    render(<RecentsRail />)

    await type('t')
    await type('th')
    await type('thunk')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1)
    })
    expect(fetchMock).not.toHaveBeenCalled()

    await settle(1)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = searchUrls(fetchMock)
    expect(url.pathname).toBe('/api/workspace/sessions/search')
    expect(url.searchParams.get('q')).toBe('thunk')
    expect(url.searchParams.get('includeArchived')).toBe('false')
    expect(useWorkspaceStore.getState().searchTerm).toBe('thunk')
  })

  it('shows matching sessions with the matching passage in place of the history', async () => {
    stubSearch(() => [THUNK_RESULT, TITLE_RESULT])
    render(<RecentsRail />)

    await type('thunk')
    await settle()

    const results = screen.getAllByTestId('search-result')
    expect(results).toHaveLength(2)
    expect(within(results[0]).getByRole('button', { name: 'Haskell' })).toBeInTheDocument()
    expect(within(results[0]).getByTestId('search-snippet')).toHaveTextContent(
      'The runtime overwrites the thunk in place',
    )
    expect(within(results[1]).queryByTestId('search-snippet')).not.toBeInTheDocument()
    // The grouped history is not shown under the results.
    expect(screen.queryAllByTestId('session-entry')).toHaveLength(0)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('shows the grouped history again when the query is cleared', async () => {
    const fetchMock = stubSearch(() => [THUNK_RESULT])
    render(<RecentsRail />)

    await type('thunk')
    await settle()
    await type('   ')
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryAllByTestId('search-result')).toHaveLength(0)
    expect(entryTitles()).toHaveLength(5)
  })

  it('reports no matches rather than falling back to the full list', async () => {
    stubSearch(() => [])
    render(<RecentsRail />)

    await type('zzz')
    await settle()

    expect(screen.getByText('No sessions match.')).toBeInTheDocument()
    expect(entryTitles()).toEqual([])
  })

  it('says so when the search fails', async () => {
    stubSearch(() => new Error('index unavailable'))
    render(<RecentsRail />)

    await type('thunk')
    await settle()

    expect(screen.getByRole('alert')).toHaveTextContent(/Search failed/)
  })

  it('never lets an older answer land over a newer query', async () => {
    let release: (() => void) | undefined
    const fetchMock = vi.fn((input: unknown) => {
      const q = new URL(String(input), 'http://localhost').searchParams.get('q')
      const body = { results: q === 'old' ? [TITLE_RESULT] : [THUNK_RESULT] }
      const response = { ok: true, status: 200, json: () => Promise.resolve(body) } as Response
      if (q === 'old') return new Promise<Response>((resolve) => (release = () => resolve(response)))
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<RecentsRail />)

    await type('old')
    await settle()
    await type('new')
    await settle()
    await act(async () => release?.())
    await settle(0)

    const results = screen.getAllByTestId('search-result')
    expect(results).toHaveLength(1)
    expect(within(results[0]).getByRole('button', { name: 'Haskell' })).toBeInTheDocument()
  })

  it('includes archived sessions only when asked', async () => {
    const fetchMock = stubSearch(() => [])
    render(<RecentsRail />)

    // The toggle belongs to a search, so it appears with one.
    expect(screen.queryByRole('checkbox', { name: 'Include archived' })).not.toBeInTheDocument()
    await type('thunk')
    await settle()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }))
    await settle()

    const urls = searchUrls(fetchMock)
    expect(urls.map((url) => url.searchParams.get('includeArchived'))).toEqual(['false', 'true'])
  })

  it('marks an archived result and restores it instead of opening it', async () => {
    render(<RecentsRail />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive Haskell' }))
    let archived = true
    const fetchMock = stubSearch(() => [{ ...THUNK_RESULT, archived }])

    await type('thunk')
    await settle()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }))
    await settle()

    const result = screen.getByTestId('search-result')
    expect(result).toHaveAttribute('data-archived', 'true')
    expect(within(result).getByText('Archived')).toBeInTheDocument()
    // Not openable while archived.
    expect(within(result).queryByRole('button', { name: 'Haskell' })).not.toBeInTheDocument()

    archived = false
    await act(async () => {
      fireEvent.click(within(result).getByRole('button', { name: 'Restore Haskell' }))
    })
    await settle()

    expect(useWorkspaceStore.getState().graph.nodes.some((n) => n.id === 'n-haskell')).toBe(true)
    // Asked again, so the result now reads as the restored session it is.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(
      within(screen.getByTestId('search-result')).getByRole('button', { name: 'Haskell' }),
    ).toBeInTheDocument()
  })

  it('opens a message result on its node and thread, at that message', async () => {
    stubSearch(() => [THUNK_RESULT])
    render(<RecentsRail />)

    await type('thunk')
    await settle()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Haskell' }))
    })

    const state = useWorkspaceStore.getState()
    expect(state.openNodeId).toBe('n-haskell')
    expect(state.openThreadId).toBe('t-haskell-once')
    expect(state.revealedMessageId).toBe('m-on-2')
  })

  it('opens a title-only result on its main thread', async () => {
    stubSearch(() => [TITLE_RESULT])
    render(<RecentsRail />)

    await type('category')
    await settle()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Category Theory' }))
    })

    const state = useWorkspaceStore.getState()
    expect(state.openNodeId).toBe('n-cat')
    expect(state.openThreadId).toBe('t-cat-main')
    expect(state.revealedMessageId).toBeNull()
  })
})

describe('RecentsRail — projects', () => {
  const store = () => useWorkspaceStore.getState()

  async function algebraWith(...nodeIds: string[]): Promise<string> {
    let id = ''
    await act(async () => {
      id = await store().createProject('Algebra')
      for (const nodeId of nodeIds) await store().moveNodeToProject(nodeId, id)
    })
    return id
  }

  it('names each entry\'s project while every project is shown', async () => {
    await algebraWith('n-haskell')
    render(<RecentsRail />)

    expect(within(entryFor('Haskell')).getByTestId('session-project')).toHaveTextContent('Algebra')
    expect(within(entryFor('Functors')).getByTestId('session-project')).toHaveTextContent('General')
  })

  it('narrows the history to one project, still grouped by day, and drops the chips', async () => {
    const id = await algebraWith('n-haskell', 'n-cat')
    render(<RecentsRail />)

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: id } })

    expect(entryTitles()).toEqual(['Haskell', 'Category Theory'])
    expect(screen.queryByTestId('session-project')).not.toBeInTheDocument()
    expect(screen.getAllByRole('region').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } })
    expect(entryTitles()).toHaveLength(5)
  })

  it('says so when the filtered project has no sessions', async () => {
    const id = await algebraWith()
    render(<RecentsRail />)

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: id } })

    expect(screen.getByText('No sessions in this project yet.')).toBeInTheDocument()
  })

  it('leaves the canvas and the store\'s sessions alone when filtering', async () => {
    const id = await algebraWith('n-haskell')
    const graph = store().graph
    render(<RecentsRail />)

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: id } })

    expect(store().graph).toBe(graph)
  })

  it('moves a session from its entry, offering unarchived projects other than its own', async () => {
    const algebra = await algebraWith()
    let archivedId = ''
    await act(async () => {
      archivedId = await store().createProject('Shelved')
      await store().archiveProject(archivedId)
    })
    render(<RecentsRail />)

    fireEvent.click(within(entryFor('Haskell')).getByRole('button', { name: 'Move Haskell to a project' }))
    const menu = screen.getByRole('group', { name: 'Move Haskell to' })
    expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['Algebra'])

    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: 'Move Haskell to Algebra' }))
    })

    expect(store().graph.nodes.find((n) => n.id === 'n-haskell')!.projectId).toBe(algebra)
    expect(within(entryFor('Haskell')).getByTestId('session-project')).toHaveTextContent('Algebra')
  })

  it('shows the refusal when a search result of an archived project is restored', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const id = await algebraWith('n-haskell')
    await act(async () => store().archiveProject(id))
    stubSearch(() => [{ ...THUNK_RESULT, archived: true }])
    render(<RecentsRail />)
    await type('thunk')
    await settle()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }))
    await settle()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore Haskell' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Restore the project Algebra first')
    expect(store().graph.nodes.some((n) => n.id === 'n-haskell')).toBe(false)
  })
})
