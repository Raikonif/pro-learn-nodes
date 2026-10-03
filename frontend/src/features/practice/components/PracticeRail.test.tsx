import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { PracticeAttempt, PracticeItem } from '../practice-api'
import { createFakePracticeBackend, type FakePracticeBackend } from '../practice-fake-backend'
import { SANDBOX_SAVE_DELAY_MS, usePracticeStore } from '../practice-store'
import { readArrangements } from '../workbench/arrangement'

import PracticeRail from './PracticeRail'

// The sandbox component (editor, runner, result pane) is its own unit with its
// own suite. Here it is a stand-in honouring the same props, so these tests
// assert what the rail owns: which node's buffer it is given and what happens
// to the edits it reports. The stand-in keeps a run result in local state, as
// the real one does, to show that result is not carried across nodes.
vi.mock('../sandbox', async () => {
  const { useState } = await import('react')
  function SandboxTool({
    nodeId,
    code,
    onCodeChange,
  }: {
    nodeId: string
    code: string
    onCodeChange: (code: string) => void
  }) {
    const [output, setOutput] = useState<string | null>(null)
    return (
      <div data-testid="sandbox-tool" data-node-id={nodeId}>
        <textarea aria-label="Code" value={code} onChange={(e) => onCodeChange(e.target.value)} />
        <button type="button" onClick={() => setOutput(`ran: ${code}`)}>
          Run
        </button>
        {output !== null && <pre data-testid="sandbox-output">{output}</pre>}
      </div>
    )
  }
  return { SandboxTool }
})

const STORAGE_KEY = 'learn-nodes.workbench'
const CODEX = { agentId: 'agent-codex', name: 'Codex' }

let backend: FakePracticeBackend

beforeEach(() => {
  backend = createFakePracticeBackend()
  vi.stubGlobal('fetch', vi.fn(backend.fetch))
  localStorage.clear()
  usePracticeStore.getState().discard()
  // discard() keeps arrangements by design (they are this device's view).
  usePracticeStore.setState({ arrangements: {} })
  useWorkspaceStore.getState().reset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function openNode(nodeId: string | null) {
  act(() => {
    useWorkspaceStore.setState({ openNodeId: nodeId })
  })
}

function renderRailOn(nodeId: string, props: { onAskAgent?: (command: string) => void } = {}) {
  openNode(nodeId)
  return render(<PracticeRail {...props} />)
}

/** The keys of the listed (open) blocks, top to bottom. */
function listedBlocks(): string[] {
  return screen.queryAllByTestId('practice-block').map((li) => li.getAttribute('data-block-key') ?? '')
}

function blockEntry(key: string): HTMLElement {
  const entry = screen
    .queryAllByTestId('practice-block')
    .find((li) => li.getAttribute('data-block-key') === key)
  if (!entry) throw new Error(`no block ${key}; listed: ${listedBlocks().join(', ')}`)
  return entry
}

/** A block's disclosure button (the header), as opposed to its close button. */
function blockHeader(key: string): HTMLElement {
  const header = blockEntry(key).querySelector<HTMLElement>('button[aria-expanded]')
  if (!header) throw new Error(`block ${key} has no header`)
  return header
}

function openAddMenu() {
  fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
  return screen.getByRole('menu', { name: 'Add practice' })
}

function chooseFromAddMenu(name: string | RegExp) {
  const menu = openAddMenu()
  fireEvent.click(within(menu).getByRole('menuitem', { name }))
}

function quizItem(nodeId: string, prompt: string, fields: Partial<PracticeItem> = {}): PracticeItem {
  return backend.addItem(nodeId, {
    kind: 'multiple_choice',
    prompt,
    options: [
      { text: 'right', correct: true },
      { text: 'wrong', correct: false },
    ],
    ...fields,
  })
}

function recordAttempt(item: PracticeItem, correct: boolean): void {
  const attempt: PracticeAttempt = {
    id: `attempt-for-${item.id}`,
    itemId: item.id,
    nodeId: item.nodeId,
    response: null,
    chosenOption: correct ? 0 : 1,
    correct,
    score: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    runOutcome: null,
    runOutput: null,
  }
  backend.node(item.nodeId).attempts.unshift(attempt)
}

describe('PracticeRail — only while a node is open', () => {
  it('renders nothing and reads nothing with no node open', () => {
    openNode(null)
    const { container } = render(<PracticeRail />)

    expect(container).toBeEmptyDOMElement()
    expect(backend.requests).toHaveLength(0)
  })
})

describe('PracticeRail — the workbench shows the node’s practice as blocks', () => {
  it('lists a delivered quiz and an exercise as one block each, naming the author, newest first', async () => {
    quizItem('node-a', 'Pick one', { authoredBy: CODEX, deliveryId: 'msg-1' })
    quizItem('node-a', 'Pick another', { authoredBy: CODEX, deliveryId: 'msg-1' })
    const exercise = backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Sum 1..10',
      starterCode: '',
      authoredBy: CODEX,
      deliveryId: 'msg-2',
    })
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(listedBlocks()).toEqual([`exercise:${exercise.id}`, 'delivery:msg-1'])
    expect(blockHeader('delivery:msg-1')).toHaveTextContent('Quiz')
    expect(blockHeader('delivery:msg-1')).toHaveTextContent('Codex · 2 questions')
    expect(blockHeader(`exercise:${exercise.id}`)).toHaveTextContent('Sum 1..10')
    expect(blockHeader(`exercise:${exercise.id}`)).toHaveTextContent('Codex · not submitted')
  })

  it('keeps two deliveries of the same kind in two blocks, each with only its own questions', async () => {
    quizItem('node-a', 'First quiz, question 1', { authoredBy: CODEX, deliveryId: 'msg-1' })
    quizItem('node-a', 'First quiz, question 2', { authoredBy: CODEX, deliveryId: 'msg-1' })
    quizItem('node-a', 'Second quiz', { authoredBy: CODEX, deliveryId: 'msg-2' })
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(listedBlocks()).toEqual(['delivery:msg-2', 'delivery:msg-1'])

    // The newest is expanded until the learner chooses otherwise.
    const newest = within(blockEntry('delivery:msg-2')).getByRole('region')
    expect(within(newest).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Second quiz',
    ])

    fireEvent.click(blockHeader('delivery:msg-1'))
    const older = within(blockEntry('delivery:msg-1')).getByRole('region', { name: 'First quiz, question 1' })
    expect(within(older).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'First quiz, question 1',
      'First quiz, question 2',
    ])
  })

  it('summarises answered and correct in the header without the block being expanded', async () => {
    const q1 = quizItem('node-a', 'Q1', { authoredBy: CODEX, deliveryId: 'msg-1' })
    const q2 = quizItem('node-a', 'Q2', { authoredBy: CODEX, deliveryId: 'msg-1' })
    quizItem('node-a', 'Q3', { authoredBy: CODEX, deliveryId: 'msg-1' })
    recordAttempt(q1, true)
    recordAttempt(q2, false)
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    fireEvent.click(blockHeader('delivery:msg-1'))
    expect(blockHeader('delivery:msg-1')).toHaveAttribute('aria-expanded', 'false')
    expect(blockHeader('delivery:msg-1')).toHaveAccessibleName(
      'Quiz: Q1, by Codex, 3 questions · 2/3 answered · 1 correct',
    )
  })
})

describe('PracticeRail — one block is expanded at a time', () => {
  it('expands the newest block by default and renders the rest as headers', async () => {
    quizItem('node-a', 'Older', { authoredBy: CODEX, deliveryId: 'msg-1' })
    quizItem('node-a', 'Newer', { authoredBy: CODEX, deliveryId: 'msg-2' })
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(blockHeader('delivery:msg-2')).toHaveAttribute('aria-expanded', 'true')
    expect(blockHeader('delivery:msg-1')).toHaveAttribute('aria-expanded', 'false')
    const list = screen.getByRole('list', { name: 'Practice blocks' })
    expect(within(list).getAllByRole('region')).toHaveLength(1)
    expect(blockHeader('delivery:msg-2')).toHaveAttribute(
      'aria-controls',
      within(blockEntry('delivery:msg-2')).getByRole('region').id,
    )
  })

  it('expanding another block collapses the first and keeps the code typed in it', async () => {
    backend.node('node-a').code = 'print("scratch")'
    quizItem('node-a', 'Pick one', { authoredBy: CODEX, deliveryId: 'msg-1' })
    renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })

    fireEvent.click(blockHeader('scratch'))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Code' }), {
      target: { value: 'unsaved = True' },
    })

    fireEvent.click(blockHeader('delivery:msg-1'))
    expect(blockHeader('delivery:msg-1')).toHaveAttribute('aria-expanded', 'true')
    expect(blockHeader('scratch')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Code' })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Pick one' })).toBeInTheDocument()

    fireEvent.click(blockHeader('scratch'))
    expect(await screen.findByRole('textbox', { name: 'Code' })).toHaveValue('unsaved = True')
  })

  it('collapsing the expanded block leaves every block a header', async () => {
    quizItem('node-a', 'Pick one', { authoredBy: CODEX, deliveryId: 'msg-1' })
    renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })

    fireEvent.click(blockHeader('delivery:msg-1'))

    expect(blockHeader('delivery:msg-1')).toHaveAttribute('aria-expanded', 'false')
    const list = screen.getByRole('list', { name: 'Practice blocks' })
    expect(within(list).queryByRole('region')).not.toBeInTheDocument()
  })
})

describe('PracticeRail — blocks appear when the work exists or is asked for', () => {
  it('an empty node lists no blocks, says it has no practice yet, and offers adding some', async () => {
    renderRailOn('node-a')

    const empty = await screen.findByTestId('workbench-empty')
    expect(empty).toHaveTextContent('This node has no practice yet.')
    expect(listedBlocks()).toEqual([])
    const add = screen.getByRole('button', { name: '+ Add' })
    expect(add).toHaveAttribute('aria-haspopup', 'menu')
    expect(add).toHaveAttribute('aria-expanded', 'false')
  })

  it('writing a quiz question from the add control expands the learner’s quiz block with the form open', async () => {
    renderRailOn('node-a')
    await screen.findByTestId('workbench-empty')

    chooseFromAddMenu('Write a quiz question')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(listedBlocks()).toEqual(['mine:quiz'])
    expect(blockHeader('mine:quiz')).toHaveAttribute('aria-expanded', 'true')
    expect(blockHeader('mine:quiz')).toHaveAccessibleName('Quiz: Your quiz questions, nothing yet')
    expect(screen.getByRole('form', { name: 'New quiz question' })).toBeInTheDocument()
  })

  it('the learner’s quiz block opened empty says so and offers authoring once the form is put away', async () => {
    renderRailOn('node-a')
    await screen.findByTestId('workbench-empty')
    chooseFromAddMenu('Write a quiz question')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('No quiz questions yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write a quiz question' })).toBeEnabled()

    // Re-expanding later does not reopen the form on its own.
    fireEvent.click(blockHeader('mine:quiz'))
    fireEvent.click(blockHeader('mine:quiz'))
    expect(screen.queryByRole('form', { name: 'New quiz question' })).not.toBeInTheDocument()
  })

  it('writing a question opens the learner’s questions block with its form open', async () => {
    renderRailOn('node-a')
    await screen.findByTestId('workbench-empty')

    chooseFromAddMenu('Write a question')

    expect(listedBlocks()).toEqual(['mine:qa'])
    expect(blockHeader('mine:qa')).toHaveAttribute('aria-expanded', 'true')
    expect(within(blockEntry('mine:qa')).getByRole('region', { name: 'Your questions' })).toBeInTheDocument()
  })

  it('opening scratch code presents an editable empty sandbox rather than an empty state', async () => {
    renderRailOn('node-a')
    await screen.findByTestId('workbench-empty')

    chooseFromAddMenu('Open scratch code')

    expect(listedBlocks()).toEqual(['scratch'])
    expect(blockHeader('scratch')).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('textbox', { name: 'Code' })).toHaveValue('')
    expect(screen.queryByText(/no code/i)).not.toBeInTheDocument()
  })

  it('a scratch buffer holding code is listed without being opened', async () => {
    backend.node('node-a').code = 'print(1)\nprint(2)\n'
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(listedBlocks()).toEqual(['scratch'])
    expect(blockHeader('scratch')).toHaveAccessibleName('Scratch: Scratch code, 2 lines')
  })

  it('asking the agent places the command and sends nothing', async () => {
    const onAskAgent = vi.fn()
    renderRailOn('node-a', { onAskAgent })
    await screen.findByTestId('workbench-empty')

    chooseFromAddMenu(/Ask the agent for an exercise/)
    expect(onAskAgent).toHaveBeenLastCalledWith('/code ')
    chooseFromAddMenu(/Ask the agent for a quiz/)
    expect(onAskAgent).toHaveBeenLastCalledWith('/quiz ')
    chooseFromAddMenu(/Ask the agent for questions/)
    expect(onAskAgent).toHaveBeenLastCalledWith('/qa ')

    expect(onAskAgent).toHaveBeenCalledTimes(3)
    expect(backend.requests.filter((request) => request.method !== 'GET')).toEqual([])
    expect(screen.getByTestId('workbench-empty')).toBeInTheDocument()
  })

  it('offers no asking the agent without a way to reach the composer', async () => {
    renderRailOn('node-a')
    await screen.findByTestId('workbench-empty')

    const menu = openAddMenu()

    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open scratch code',
      'Write a quiz question',
      'Write a question',
    ])
  })

  it('Escape puts the add menu away', async () => {
    renderRailOn('node-a')
    await screen.findByTestId('workbench-empty')
    const menu = openAddMenu()

    fireEvent.keyDown(menu, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('PracticeRail — a block can be closed without losing anything', () => {
  it('a closed block leaves the list, is counted, and reopens expanded', async () => {
    const q = quizItem('node-a', 'Pick one', { authoredBy: CODEX, deliveryId: 'msg-1' })
    recordAttempt(q, true)
    quizItem('node-a', 'Another', { authoredBy: CODEX, deliveryId: 'msg-2' })
    renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })
    const requestsBefore = backend.requests.length

    fireEvent.click(within(blockEntry('delivery:msg-1')).getByRole('button', { name: 'Close Quiz: Pick one' }))

    expect(listedBlocks()).toEqual(['delivery:msg-2'])
    const closed = screen.getByRole('button', { name: 'Closed (1)' })
    expect(closed).toHaveAttribute('aria-expanded', 'false')
    // Closing is a view change: nothing is written or deleted.
    expect(backend.requests.slice(requestsBefore)).toEqual([])

    fireEvent.click(closed)
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Quiz: Pick one' }))

    expect(listedBlocks()).toEqual(['delivery:msg-2', 'delivery:msg-1'])
    expect(blockHeader('delivery:msg-1')).toHaveAttribute('aria-expanded', 'true')
    expect(blockHeader('delivery:msg-1')).toHaveTextContent('1/1 answered · 1 correct')
    expect(screen.queryByRole('button', { name: /^Closed/ })).not.toBeInTheDocument()
  })

  it('closing the expanded block leaves nothing expanded', async () => {
    quizItem('node-a', 'Older', { authoredBy: CODEX, deliveryId: 'msg-1' })
    quizItem('node-a', 'Newer', { authoredBy: CODEX, deliveryId: 'msg-2' })
    renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })
    fireEvent.click(blockHeader('delivery:msg-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Close Quiz: Older' }))

    expect(listedBlocks()).toEqual(['delivery:msg-2'])
    expect(blockHeader('delivery:msg-2')).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('PracticeRail — the arrangement is a view preference of this device', () => {
  it('keeps closed and expanded per node in local storage and sends none of it to the backend', async () => {
    quizItem('node-a', 'Q one', { authoredBy: CODEX, deliveryId: 'msg-1' })
    quizItem('node-a', 'Q two', { authoredBy: CODEX, deliveryId: 'msg-2' })
    quizItem('node-a', 'Q three', { authoredBy: CODEX, deliveryId: 'msg-3' })
    renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })
    const nodesBefore = useWorkspaceStore.getState().graph.nodes

    fireEvent.click(screen.getByRole('button', { name: 'Close Quiz: Q three' }))
    fireEvent.click(blockHeader('delivery:msg-1'))

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')['node-a']).toMatchObject({
      expanded: 'delivery:msg-1',
      closed: ['delivery:msg-3'],
    })
    expect(useWorkspaceStore.getState().graph.nodes).toBe(nodesBefore)
    expect(backend.requests.filter((request) => request.method !== 'GET')).toEqual([])
    expect(JSON.stringify(backend.requests)).not.toMatch(/delivery:|expanded|closed/)
  })

  it('the same block is closed and the same expanded after a restart', async () => {
    quizItem('node-a', 'Q one', { authoredBy: CODEX, deliveryId: 'msg-1' })
    quizItem('node-a', 'Q two', { authoredBy: CODEX, deliveryId: 'msg-2' })
    quizItem('node-a', 'Q three', { authoredBy: CODEX, deliveryId: 'msg-3' })
    const first = renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Quiz: Q three' }))
    fireEvent.click(blockHeader('delivery:msg-1'))
    openNode(null)
    first.unmount()

    // A fresh window: nothing in memory, the arrangement read back from storage.
    usePracticeStore.getState().discard()
    usePracticeStore.setState({ arrangements: readArrangements() })
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(listedBlocks()).toEqual(['delivery:msg-2', 'delivery:msg-1'])
    expect(blockHeader('delivery:msg-1')).toHaveAttribute('aria-expanded', 'true')
    expect(blockHeader('delivery:msg-2')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Closed (1)' })).toBeInTheDocument()
  })

  it('another node shows its own arrangement', async () => {
    quizItem('node-a', 'A one', { authoredBy: CODEX, deliveryId: 'msg-a1' })
    quizItem('node-a', 'A two', { authoredBy: CODEX, deliveryId: 'msg-a2' })
    quizItem('node-b', 'B one', { authoredBy: CODEX, deliveryId: 'msg-b1' })
    quizItem('node-b', 'B two', { authoredBy: CODEX, deliveryId: 'msg-b2' })
    renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Quiz: A two' }))

    openNode('node-b')
    await waitFor(() => expect(listedBlocks()).toEqual(['delivery:msg-b2', 'delivery:msg-b1']))
    expect(blockHeader('delivery:msg-b2')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: /^Closed/ })).not.toBeInTheDocument()

    openNode('node-a')
    await waitFor(() => expect(listedBlocks()).toEqual(['delivery:msg-a1']))
    expect(screen.getByRole('button', { name: 'Closed (1)' })).toBeInTheDocument()
  })
})

describe('PracticeRail — unavailable material', () => {
  it('names what could not be loaded in place of the blocks and offers a retry', async () => {
    quizItem('node-a', 'Pick one', { authoredBy: CODEX, deliveryId: 'msg-1' })
    backend.failReads(true)
    renderRailOn('node-a')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("This node's practice material could not be loaded.")
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByRole('list', { name: 'Practice blocks' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('workbench-empty')).not.toBeInTheDocument()
  })

  it('a retry lists the node’s blocks without reopening the node', async () => {
    quizItem('node-a', 'Pick one', { authoredBy: CODEX, deliveryId: 'msg-1' })
    backend.failReads(true)
    renderRailOn('node-a')
    await screen.findByRole('alert')

    backend.failReads(false)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(listedBlocks()).toEqual(['delivery:msg-1']))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Pick one' })).toBeInTheDocument()
  })
})

describe('PracticeRail — sandbox buffer persistence', () => {
  async function openScratch() {
    await screen.findByTestId('workbench-empty')
    chooseFromAddMenu('Open scratch code')
  }

  async function typeCode(code: string) {
    fireEvent.change(await screen.findByRole('textbox', { name: 'Code' }), {
      target: { value: code },
    })
  }

  it('persists an edit without an explicit save', async () => {
    renderRailOn('node-a')
    await openScratch()
    await typeCode('x = 1')

    await waitFor(() => expect(backend.node('node-a').code).toBe('x = 1'), {
      timeout: SANDBOX_SAVE_DELAY_MS * 4,
    })
    const puts = backend.requestsTo('PUT', /sandbox$/)
    expect(puts[puts.length - 1]?.body).toEqual({ code: 'x = 1' })
  })

  it('flushes a pending edit when another node is opened', async () => {
    renderRailOn('node-a')
    await openScratch()
    await typeCode('pending = True')
    expect(backend.requestsTo('PUT', /sandbox$/)).toHaveLength(0)

    openNode('node-b')

    await waitFor(() => expect(backend.node('node-a').code).toBe('pending = True'))
    expect(backend.node('node-b').code).toBe('')
  })

  it('flushes a pending edit when the node is closed', async () => {
    const { unmount } = renderRailOn('node-a')
    await openScratch()
    await typeCode('closing = True')

    // The workspace unmounts the rail when the node closes.
    openNode(null)
    unmount()

    await waitFor(() => expect(backend.node('node-a').code).toBe('closing = True'))
    expect(backend.requestsTo('PUT', /sandbox$/)).toHaveLength(1)
  })

  it('restores the persisted code when the node is reopened', async () => {
    const first = renderRailOn('node-a')
    await openScratch()
    await typeCode('kept = 42')
    openNode(null)
    first.unmount()
    await waitFor(() => expect(backend.node('node-a').code).toBe('kept = 42'))

    // A fresh window: nothing cached, the code must come from the backend.
    usePracticeStore.getState().discard()
    usePracticeStore.setState({ arrangements: {} })
    renderRailOn('node-a')

    expect(await screen.findByDisplayValue('kept = 42')).toBeInTheDocument()
    expect(blockHeader('scratch')).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows no result from an earlier run when the node is reopened', async () => {
    backend.node('node-a').code = 'print(1)'
    backend.node('node-b').code = 'print(2)'
    renderRailOn('node-a')
    await screen.findByDisplayValue('print(1)')
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(screen.getByTestId('sandbox-output')).toBeInTheDocument()

    openNode('node-b')
    await screen.findByDisplayValue('print(2)')
    openNode('node-a')

    expect(await screen.findByDisplayValue('print(1)')).toBeInTheDocument()
    expect(screen.queryByTestId('sandbox-output')).not.toBeInTheDocument()
  })

  it('keeps two nodes’ buffers independent, and an unvisited node’s empty', async () => {
    renderRailOn('node-a')
    await openScratch()
    await typeCode('a = "A"')

    openNode('node-b')
    await openScratch()
    await waitFor(() =>
      expect(screen.getByTestId('sandbox-tool')).toHaveAttribute('data-node-id', 'node-b'),
    )
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('')
    await typeCode('b = "B"')

    openNode('node-a')
    expect(await screen.findByDisplayValue('a = "A"')).toBeInTheDocument()

    openNode('node-c')
    await openScratch()
    await waitFor(() =>
      expect(screen.getByTestId('sandbox-tool')).toHaveAttribute('data-node-id', 'node-c'),
    )
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('')

    await waitFor(() => {
      expect(backend.node('node-a').code).toBe('a = "A"')
      expect(backend.node('node-b').code).toBe('b = "B"')
    })
    expect(backend.node('node-c').code).toBe('')
  })

  it('says so when the code could not be saved, and retries', async () => {
    renderRailOn('node-a')
    await openScratch()
    await screen.findByRole('textbox', { name: 'Code' })
    const realFetch = backend.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? Promise.resolve(new Response('{"detail":"down"}', { status: 503 }))
          : realFetch(url, init),
      ),
    )
    await typeCode('lost = False')

    const warning = await screen.findByText('Your code could not be saved.', undefined, {
      timeout: SANDBOX_SAVE_DELAY_MS * 4,
    })
    expect(warning).toBeInTheDocument()

    vi.stubGlobal('fetch', vi.fn(realFetch))
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }))

    await waitFor(() => expect(backend.node('node-a').code).toBe('lost = False'))
    expect(screen.queryByText('Your code could not be saved.')).not.toBeInTheDocument()
  })
})
