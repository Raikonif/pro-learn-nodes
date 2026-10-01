import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { revealPractice } from '../index'
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
  usePracticeStore.getState().discard()
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

function selectTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

const CODEX = { agentId: 'agent-codex', name: 'Codex' }

describe('PracticeRail — who wrote an item (6.2)', () => {
  it("marks an agent's question with its name and the learner's with none", async () => {
    backend.addItem('node-a', { kind: 'free_response', prompt: 'Mine?' })
    backend.addItem('node-a', { kind: 'free_response', prompt: 'Theirs?', authoredBy: CODEX })
    renderRailOn('node-a')

    const theirs = await screen.findByRole('article', { name: 'Theirs?' })
    expect(within(theirs).getByTestId('item-author')).toHaveTextContent('by Codex')
    expect(within(screen.getByRole('article', { name: 'Mine?' })).queryByTestId('item-author')).toBeNull()
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
    })
    renderRailOn('node-a')
    selectTab('Quiz')

    const card = await screen.findByRole('article', { name: 'Pick one' })
    expect(within(card).getByTestId('item-author')).toHaveTextContent('by Claude')
  })
})

describe('PracticeRail — the Code tool lists exercises (4c.5)', () => {
  it('shows only the free sandbox while the node has no exercises', async () => {
    renderRailOn('node-a')
    selectTab('Code')

    await screen.findByTestId('sandbox-tool')
    expect(screen.queryByRole('list', { name: 'Code exercises' })).toBeNull()
  })

  it("lists each exercise's statement, author and attempts beside the free sandbox", async () => {
    backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Sum 1..10\nPrint the total.',
      starterCode: 'total = 0\n',
      authoredBy: CODEX,
    })
    backend.addItem('node-a', { kind: 'code_exercise', prompt: 'Reverse a list', starterCode: '' })
    renderRailOn('node-a')
    selectTab('Code')

    const list = await screen.findByRole('list', { name: 'Code exercises' })
    const entries = within(list).getAllByRole('button')
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'Free sandbox',
      'Sum 1..10by Codex · 0 attempts',
      'Reverse a listYou · 0 attempts',
    ])
    // The free sandbox is what is open until an exercise is chosen.
    expect(within(list).getByRole('button', { name: 'Free sandbox' })).toHaveAttribute('aria-pressed', 'true')
  })

  it("opens an exercise with its full statement, expected output, and its starter code", async () => {
    backend.node('node-a').code = 'free_code()'
    backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Sum 1..10\nPrint the total.',
      starterCode: 'total = 0\n',
      expectedOutput: '55',
      authoredBy: CODEX,
    })
    renderRailOn('node-a')
    selectTab('Code')

    fireEvent.click(await screen.findByRole('button', { name: /Sum 1\.\.10/ }))

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
    selectTab('Code')

    fireEvent.click(await screen.findByRole('button', { name: /^Sum/ }))
    const editor = await screen.findByRole('textbox', { name: 'Code' })
    fireEvent.change(editor, { target: { value: 'solution()' } })
    await waitFor(
      () =>
        expect(
          backend.requestsTo('PUT', new RegExp(`/sandbox\\?itemId=${item.id}$`)).map((r) => r.body),
        ).toEqual([{ code: 'solution()' }]),
      { timeout: SANDBOX_SAVE_DELAY_MS * 4 },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Free sandbox' }))
    expect(await screen.findByRole('textbox', { name: 'Code' })).toHaveValue('free_code()')

    fireEvent.click(screen.getByRole('button', { name: /^Sum/ }))
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
    selectTab('Code')
    fireEvent.click(await screen.findByRole('button', { name: /^Sum/ }))
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
    expect(screen.getByRole('button', { name: /^Sum/ })).toHaveTextContent('1 attempt')
  })

  it('claims no match either way when the exercise has no expected output', async () => {
    backend.addItem('node-a', { kind: 'code_exercise', prompt: 'Explore', starterCode: 'print(1)' })
    renderRailOn('node-a')
    selectTab('Code')
    fireEvent.click(await screen.findByRole('button', { name: /^Explore/ }))
    await screen.findByRole('textbox', { name: 'Code' })
    nextRun.result = {
      output: [{ stream: 'stdout', text: '1\n' }],
      outcome: { kind: 'completed' },
      outputTruncated: false,
    }

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    const latest = await screen.findByRole('region', { name: 'Latest submission' })
    expect(latest).not.toHaveTextContent(/match/i)
  })
})

describe('PracticeRail — delivered practice is revealed (4c.3)', () => {
  it('switches to Quiz, shows the newly delivered questions, and highlights them', async () => {
    renderRailOn('node-a')
    await screen.findByText('This node has no questions yet.')

    const delivered = backend.addItem('node-a', {
      kind: 'multiple_choice',
      prompt: 'What does foldr do?',
      options: [
        { text: 'folds right', correct: true },
        { text: 'folds left', correct: false },
      ],
      authoredBy: CODEX,
    })
    act(() => revealPractice({ nodeId: 'node-a', tool: 'quiz', itemIds: [delivered.id] }))

    expect(screen.getByRole('tab', { name: 'Quiz' })).toHaveAttribute('aria-selected', 'true')
    const card = await screen.findByRole('article', { name: 'What does foldr do?' })
    expect(card).toHaveAttribute('data-highlighted', 'true')
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('lets the highlight fade', async () => {
    const delivered = backend.addItem('node-a', { kind: 'free_response', prompt: 'Why?' })
    renderRailOn('node-a')
    await screen.findByRole('article', { name: 'Why?' })
    vi.useFakeTimers()

    act(() => revealPractice({ nodeId: 'node-a', tool: 'qa', itemIds: [delivered.id] }))
    expect(screen.getByRole('article', { name: 'Why?' })).toHaveAttribute('data-highlighted', 'true')

    await act(async () => vi.advanceTimersByTimeAsync(PRACTICE_HIGHLIGHT_MS))
    expect(screen.getByRole('article', { name: 'Why?' })).not.toHaveAttribute('data-highlighted')
  })

  it('opens a delivered exercise in Code with its starter code', async () => {
    renderRailOn('node-a')
    await screen.findByText('This node has no questions yet.')

    const delivered = backend.addItem('node-a', {
      kind: 'code_exercise',
      prompt: 'Write fib',
      starterCode: 'def fib(n):\n    pass\n',
      authoredBy: CODEX,
    })
    act(() => revealPractice({ nodeId: 'node-a', tool: 'code', itemIds: [delivered.id] }))

    expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('region', { name: 'Exercise' })).toHaveTextContent('Write fib')
    expect(await screen.findByRole('textbox', { name: 'Code' })).toHaveValue('def fib(n):\n    pass\n')
    expect(screen.getByRole('button', { name: /^Write fib/ })).toHaveAttribute('data-highlighted', 'true')
  })
})
