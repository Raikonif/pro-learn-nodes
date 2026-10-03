import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { revealDelivery } from '../index'
import { createFakePracticeBackend, type FakePracticeBackend } from '../practice-fake-backend'
import { PRACTICE_HIGHLIGHT_MS, SANDBOX_SAVE_DELAY_MS, usePracticeStore } from '../practice-store'
import type { RunResult } from '../sandbox'

import PracticeRail from './PracticeRail'

/**
 * What the stand-in sandbox's next run produces. The real sandbox has its own
 * suite; here a run is whatever the test says it was.
 */
const nextRun = vi.hoisted(() => ({
  result: {
    output: [] as { stream: 'stdout' | 'stderr'; text: string }[],
    outcome: { kind: 'completed' } as { kind: string },
    outputTruncated: false,
  },
}))

vi.mock('../sandbox', async () => {
  function SandboxTool({
    nodeId,
    code,
    onCodeChange,
    onSubmit,
  }: {
    nodeId: string
    code: string
    onCodeChange: (code: string) => void
    onSubmit?: (submission: { code: string; result: RunResult }) => void
  }) {
    return (
      <div data-testid="sandbox-tool" data-node-id={nodeId}>
        <textarea aria-label="Code" value={code} onChange={(e) => onCodeChange(e.target.value)} />
        {onSubmit && (
          <button type="button" onClick={() => onSubmit({ code, result: nextRun.result as RunResult })}>
            Submit
          </button>
        )}
      </div>
    )
  }
  return { SandboxTool }
})

let backend: FakePracticeBackend

beforeEach(() => {
  backend = createFakePracticeBackend()
  vi.stubGlobal('fetch', vi.fn(backend.fetch))
  localStorage.clear()
  usePracticeStore.getState().discard()
  // discard() keeps arrangements by design (they are this device's view).
  usePracticeStore.setState({ arrangements: {} })
  useWorkspaceStore.getState().reset()
  nextRun.result = { output: [], outcome: { kind: 'completed' }, outputTruncated: false }
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderRailOn(nodeId: string) {
  act(() => {
    useWorkspaceStore.setState({ openNodeId: nodeId })
  })
  return render(<PracticeRail />)
}

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

function blockHeader(key: string): HTMLElement {
  const header = blockEntry(key).querySelector<HTMLElement>('button[aria-expanded]')
  if (!header) throw new Error(`block ${key} has no header`)
  return header
}

/** The header row carries the delivery highlight while it lasts. */
function blockHighlighted(key: string): boolean {
  return blockEntry(key).querySelector('[data-highlighted="true"]') !== null
}

const CODEX = { agentId: 'agent-codex', name: 'Codex' }

describe('PracticeRail — who wrote an item (6.2)', () => {
  it("marks an agent's question with its name and the learner's with none, each in its own block", async () => {
    backend.addItem('node-a', { kind: 'free_response', prompt: 'Mine?' })
    backend.addItem('node-a', { kind: 'free_response', prompt: 'Theirs?', authoredBy: CODEX, deliveryId: 'msg-1' })
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(listedBlocks()).toEqual(['delivery:msg-1', 'mine:qa'])
    expect(blockHeader('delivery:msg-1')).toHaveAccessibleName(/by Codex/)
    expect(blockHeader('mine:qa')).not.toHaveAccessibleName(/by /)

    const theirs = screen.getByRole('article', { name: 'Theirs?' })
    expect(within(theirs).getByTestId('item-author')).toHaveTextContent('by Codex')

    fireEvent.click(blockHeader('mine:qa'))
    const mine = screen.getByRole('article', { name: 'Mine?' })
    expect(within(mine).queryByTestId('item-author')).toBeNull()
  })

  it("marks an agent's quiz question with its name", async () => {
    backend.addItem('node-a', {
      kind: 'multiple_choice',
      prompt: 'Pick one',
      options: [
        { text: 'a', correct: true },
        { text: 'b', correct: false },
      ],
      authoredBy: { agentId: null, name: 'Claude' },
      deliveryId: 'msg-1',
    })
    renderRailOn('node-a')

    const card = await screen.findByRole('article', { name: 'Pick one' })
    expect(within(card).getByTestId('item-author')).toHaveTextContent('by Claude')
  })
})

describe('PracticeRail — each code exercise is its own block (4c.5)', () => {
  it('lists each exercise as a block of its own, never grouped by delivery', async () => {
    const first = backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Sum 1..10\nPrint the total.',
      starterCode: 'total = 0\n',
      authoredBy: CODEX,
      deliveryId: 'msg-1',
    })
    const second = backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Reverse a list',
      starterCode: '',
      authoredBy: CODEX,
      deliveryId: 'msg-1',
    })
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(listedBlocks()).toEqual([`exercise:${second.id}`, `exercise:${first.id}`])
    expect(blockHeader(`exercise:${first.id}`)).toHaveAccessibleName('Code: Sum 1..10, by Codex, not submitted')
  })

  it('opens an exercise with its full statement, expected output, and its starter code', async () => {
    backend.node('node-a').code = 'free_code()'
    const item = backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Sum 1..10\nPrint the total.',
      starterCode: 'total = 0\n',
      expectedOutput: '55',
      authoredBy: CODEX,
      deliveryId: 'msg-1',
    })
    renderRailOn('node-a')

    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(blockHeader(`exercise:${item.id}`)).toHaveAttribute('aria-expanded', 'true')
    const exercise = screen.getByRole('region', { name: 'Exercise' })
    expect(exercise).toHaveTextContent('Sum 1..10 Print the total.')
    expect(within(exercise).getByTestId('expected-output')).toHaveTextContent('55')
    expect(within(exercise).getByTestId('item-author')).toHaveTextContent('by Codex')
    expect(await screen.findByRole('textbox', { name: 'Code' })).toHaveValue('total = 0\n')
  })

  it('keeps the free buffer and each exercise buffer apart, each persisted to its own place', async () => {
    backend.node('node-a').code = 'free_code()'
    const item = backend.addItem('node-a', { kind: 'code_exercise', prompt: 'Sum', starterCode: 'start' })
    renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })
    expect(listedBlocks()).toEqual([`exercise:${item.id}`, 'scratch'])

    const editor = await screen.findByRole('textbox', { name: 'Code' })
    expect(editor).toHaveValue('start')
    fireEvent.change(editor, { target: { value: 'solution()' } })
    await waitFor(
      () =>
        expect(
          backend.requestsTo('PUT', new RegExp(`/sandbox\\?itemId=${item.id}$`)).map((r) => r.body),
        ).toEqual([{ code: 'solution()' }]),
      { timeout: SANDBOX_SAVE_DELAY_MS * 4 },
    )

    fireEvent.click(blockHeader('scratch'))
    expect(blockHeader(`exercise:${item.id}`)).toHaveAttribute('aria-expanded', 'false')
    expect(await screen.findByRole('textbox', { name: 'Code' })).toHaveValue('free_code()')

    fireEvent.click(blockHeader(`exercise:${item.id}`))
    expect(await screen.findByRole('textbox', { name: 'Code' })).toHaveValue('solution()')
    expect(backend.requestsTo('PUT', /\/sandbox$/)).toHaveLength(0)
  })

  it('submits the run as an attempt and shows its outcome, output and match', async () => {
    const item = backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Sum',
      starterCode: 'print(55)',
      expectedOutput: '55',
    })
    renderRailOn('node-a')
    await screen.findByRole('textbox', { name: 'Code' })
    nextRun.result = {
      output: [{ stream: 'stdout', text: '55\n' }],
      outcome: { kind: 'completed' },
      outputTruncated: false,
    }

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    const latest = await screen.findByRole('region', { name: 'Latest submission' })
    expect(latest).toHaveTextContent('1 attempt')
    expect(latest).toHaveTextContent('Ran to completion.')
    expect(latest).toHaveTextContent('55')
    expect(latest).toHaveTextContent('The output matched the expected output.')
    expect(latest).not.toHaveTextContent(/score|grade/i)
    expect(
      backend.requestsTo('POST', new RegExp(`/items/${item.id}/attempts$`)).map((r) => r.body),
    ).toEqual([{ code: 'print(55)', runOutcome: 'completed', runOutput: '55\n' }])
    expect(blockHeader(`exercise:${item.id}`)).toHaveAccessibleName('Code: Sum, submitted · output matched')
  })

  it('claims no match either way when the exercise has no expected output', async () => {
    const item = backend.addItem('node-a', { kind: 'code_exercise', prompt: 'Explore', starterCode: 'print(1)' })
    renderRailOn('node-a')
    await screen.findByRole('textbox', { name: 'Code' })
    nextRun.result = {
      output: [{ stream: 'stdout', text: '1\n' }],
      outcome: { kind: 'completed' },
      outputTruncated: false,
    }

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    const latest = await screen.findByRole('region', { name: 'Latest submission' })
    expect(latest).not.toHaveTextContent(/match/i)
    expect(blockHeader(`exercise:${item.id}`)).toHaveAccessibleName('Code: Explore, submitted')
  })
})

describe('PracticeRail — delivered practice is revealed (4c.3)', () => {
  it('expands the delivery’s quiz block, shows the new questions, and highlights them', async () => {
    backend.addItem('node-a', { kind: 'free_response', prompt: 'Earlier?' })
    renderRailOn('node-a')
    await screen.findByRole('article', { name: 'Earlier?' })

    const delivered = backend.addItem('node-a', {
      kind: 'multiple_choice',
      prompt: 'What does foldr do?',
      options: [
        { text: 'folds right', correct: true },
        { text: 'folds left', correct: false },
      ],
      authoredBy: CODEX,
      deliveryId: 'msg-7',
    })
    act(() => revealDelivery({ nodeId: 'node-a', tool: 'quiz', messageId: 'msg-7', itemIds: [delivered.id] }))

    const card = await screen.findByRole('article', { name: 'What does foldr do?' })
    expect(card).toHaveAttribute('data-highlighted', 'true')
    expect(blockHeader('delivery:msg-7')).toHaveAttribute('aria-expanded', 'true')
    expect(blockHeader('mine:qa')).toHaveAttribute('aria-expanded', 'false')
    expect(blockHighlighted('delivery:msg-7')).toBe(true)
    expect(blockHighlighted('mine:qa')).toBe(false)
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('reopens and expands a closed delivery’s block, highlighted', async () => {
    const delivered = backend.addItem('node-a', {
      kind: 'multiple_choice',
      prompt: 'Closed one',
      options: [
        { text: 'a', correct: true },
        { text: 'b', correct: false },
      ],
      authoredBy: CODEX,
      deliveryId: 'msg-1',
    })
    backend.addItem('node-a', { kind: 'free_response', prompt: 'Still open?' })
    renderRailOn('node-a')
    await screen.findByRole('list', { name: 'Practice blocks' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Quiz: Closed one' }))
    expect(listedBlocks()).toEqual(['mine:qa'])

    act(() => revealDelivery({ nodeId: 'node-a', tool: 'quiz', messageId: 'msg-1', itemIds: [delivered.id] }))

    await waitFor(() => expect(listedBlocks()).toContain('delivery:msg-1'))
    expect(blockHeader('delivery:msg-1')).toHaveAttribute('aria-expanded', 'true')
    expect(blockHighlighted('delivery:msg-1')).toBe(true)
    expect(screen.getByRole('article', { name: 'Closed one' })).toHaveAttribute('data-highlighted', 'true')
    expect(screen.queryByRole('button', { name: /^Closed \(/ })).not.toBeInTheDocument()
  })

  it('lets the highlight fade', async () => {
    const delivered = backend.addItem('node-a', {
      kind: 'free_response',
      prompt: 'Why?',
      authoredBy: CODEX,
      deliveryId: 'msg-1',
    })
    renderRailOn('node-a')
    await screen.findByRole('article', { name: 'Why?' })
    vi.useFakeTimers()

    act(() => revealDelivery({ nodeId: 'node-a', tool: 'qa', messageId: 'msg-1', itemIds: [delivered.id] }))
    expect(screen.getByRole('article', { name: 'Why?' })).toHaveAttribute('data-highlighted', 'true')
    expect(blockHighlighted('delivery:msg-1')).toBe(true)

    await act(async () => vi.advanceTimersByTimeAsync(PRACTICE_HIGHLIGHT_MS))
    expect(screen.getByRole('article', { name: 'Why?' })).not.toHaveAttribute('data-highlighted')
    expect(blockHighlighted('delivery:msg-1')).toBe(false)
  })

  it('opens a delivered exercise in its own code block with its starter code', async () => {
    backend.addItem('node-a', { kind: 'free_response', prompt: 'Earlier?' })
    renderRailOn('node-a')
    await screen.findByRole('article', { name: 'Earlier?' })

    const delivered = backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Write fib',
      starterCode: 'def fib(n):\n    pass\n',
      authoredBy: CODEX,
      deliveryId: 'msg-9',
    })
    act(() => revealDelivery({ nodeId: 'node-a', tool: 'code', messageId: 'msg-9', itemIds: [delivered.id] }))

    expect(await screen.findByRole('region', { name: 'Exercise' })).toHaveTextContent('Write fib')
    expect(await screen.findByRole('textbox', { name: 'Code' })).toHaveValue('def fib(n):\n    pass\n')
    expect(blockHeader(`exercise:${delivered.id}`)).toHaveAttribute('aria-expanded', 'true')
    expect(blockHighlighted(`exercise:${delivered.id}`)).toBe(true)
  })

  it('practice revealed for a node not on screen leaves this node’s workbench as it was', async () => {
    backend.addItem('node-a', { kind: 'free_response', prompt: 'Here?' })
    renderRailOn('node-a')
    await screen.findByRole('article', { name: 'Here?' })

    const elsewhere = backend.addItem('node-b', {
      kind: 'multiple_choice',
      prompt: 'Elsewhere',
      options: [
        { text: 'a', correct: true },
        { text: 'b', correct: false },
      ],
      authoredBy: CODEX,
      deliveryId: 'msg-b',
    })
    act(() => revealDelivery({ nodeId: 'node-b', tool: 'quiz', messageId: 'msg-b', itemIds: [elsewhere.id] }))

    expect(listedBlocks()).toEqual(['mine:qa'])
    expect(blockHeader('mine:qa')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('article', { name: 'Elsewhere' })).not.toBeInTheDocument()

    act(() => {
      useWorkspaceStore.setState({ openNodeId: 'node-b' })
    })
    await waitFor(() => expect(listedBlocks()).toEqual(['delivery:msg-b']))
    expect(blockHeader('delivery:msg-b')).toHaveAttribute('aria-expanded', 'true')
  })
})
