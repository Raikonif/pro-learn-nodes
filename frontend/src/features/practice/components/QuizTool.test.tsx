import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { createFakePracticeBackend, type FakePracticeBackend } from '../practice-fake-backend'
import { usePracticeStore } from '../practice-store'

import QuizTool from './QuizTool'

let backend: FakePracticeBackend

beforeEach(() => {
  backend = createFakePracticeBackend()
  vi.stubGlobal('fetch', vi.fn(backend.fetch))
  usePracticeStore.getState().discard()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderTool(nodeId = 'node-a') {
  await usePracticeStore.getState().load(nodeId)
  render(<QuizTool nodeId={nodeId} />)
}

function seedQuiz() {
  backend.node('node-a').items.push({
    id: 'quiz-1',
    nodeId: 'node-a',
    kind: 'multiple_choice',
    prompt: 'Which is lazy?',
    options: [
      { text: 'Haskell', correct: true },
      { text: 'C', correct: false },
      { text: 'Go', correct: false },
    ],
    referenceAnswer: null,
    createdAt: '2026-10-01T09:00:00Z',
    starterCode: null,
    expectedOutput: null,
    authoredBy: null,
    deliveryId: null,
  })
}

function openForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Write a quiz question' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: 'Pick one' },
  })
}

function setOption(n: number, text: string, correct = false) {
  fireEvent.change(screen.getByRole('textbox', { name: `Option ${n}` }), { target: { value: text } })
  const box = screen.getByRole('checkbox', { name: `Option ${n} is correct` })
  if ((box as HTMLInputElement).checked !== correct) fireEvent.click(box)
}

async function choose(optionText: string) {
  const card = screen.getByRole('article', { name: 'Which is lazy?' })
  fireEvent.click(within(card).getByRole('radio', { name: optionText }))
  fireEvent.click(within(card).getByRole('button', { name: /Submit answer|Answer again/ }))
  await within(card).findByTestId('latest-attempt')
  return card
}

describe('QuizTool — authoring', () => {
  it('creates a multiple-choice question with each option flagged, shown at once', async () => {
    await renderTool()
    openForm()
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }))
    setOption(1, 'fmap', false)
    setOption(2, 'bind', true)
    setOption(3, 'pure', false)

    fireEvent.click(screen.getByRole('button', { name: 'Add quiz question' }))

    expect(await screen.findByRole('article', { name: 'Pick one' })).toBeInTheDocument()
    expect(backend.requestsTo('POST', /items$/)[0]?.body).toEqual({
      kind: 'multiple_choice',
      prompt: 'Pick one',
      options: [
        { text: 'fmap', correct: false },
        { text: 'bind', correct: true },
        { text: 'pure', correct: false },
      ],
    })
    expect(backend.requestsTo('GET', /./)).toHaveLength(1)
  })

  it.each([
    [
      'fewer than two options',
      () => {
        fireEvent.click(screen.getByRole('button', { name: 'Remove option 2' }))
        setOption(1, 'only', true)
      },
      'A quiz question needs at least two options.',
      [{ text: 'only', correct: true }],
    ],
    [
      'no designated correct option',
      () => {
        setOption(1, 'a')
        setOption(2, 'b')
      },
      'Mark one option as correct.',
      [
        { text: 'a', correct: false },
        { text: 'b', correct: false },
      ],
    ],
    [
      'more than one designated correct option',
      () => {
        setOption(1, 'a', true)
        setOption(2, 'b', true)
      },
      'Only one option can be correct.',
      [
        { text: 'a', correct: true },
        { text: 'b', correct: true },
      ],
    ],
  ])('surfaces the refusal for %s in place', async (_case, fill, reason, sentOptions) => {
    await renderTool()
    backend.refuseNextItem(reason)
    openForm()
    fill()

    fireEvent.click(screen.getByRole('button', { name: 'Add quiz question' }))

    const form = screen.getByRole('form', { name: 'New quiz question' })
    expect(await within(form).findByRole('alert')).toHaveTextContent(reason)
    expect(backend.requestsTo('POST', /items$/)[0]?.body).toMatchObject({ options: sentOptions })
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(backend.node('node-a').items).toHaveLength(0)
  })
})

describe('QuizTool — answering', () => {
  it('does not reveal the correct option before an answer', async () => {
    seedQuiz()
    await renderTool()

    const card = screen.getByRole('article', { name: 'Which is lazy?' })
    expect(within(card).queryByText(/Correct option/)).not.toBeInTheDocument()
  })

  it('shows a matching choice as matching', async () => {
    seedQuiz()
    await renderTool()

    const card = await choose('Haskell')

    const latest = within(card).getByTestId('latest-attempt')
    expect(latest).toHaveTextContent('Your choice matched the correct option.')
    expect(latest).toHaveTextContent('Correct option: Haskell')
    expect(backend.requestsTo('POST', /attempts$/)[0]?.body).toEqual({ chosenOption: 0 })
  })

  it('shows a wrong choice as not matching, and which option was correct', async () => {
    seedQuiz()
    await renderTool()

    const card = await choose('Go')

    const latest = within(card).getByTestId('latest-attempt')
    expect(latest).toHaveTextContent('You chose: Go')
    expect(latest).toHaveTextContent('Your choice did not match the correct option.')
    expect(latest).toHaveTextContent('Correct option: Haskell')
  })

  it('answering again shows the newest attempt and the count, leaving the first intact', async () => {
    seedQuiz()
    await renderTool()

    await choose('C')
    const card = screen.getByRole('article', { name: 'Which is lazy?' })
    fireEvent.click(within(card).getByRole('radio', { name: 'Haskell' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Answer again' }))
    await within(card).findByText('2 attempts', { exact: false })

    const latest = within(card).getByTestId('latest-attempt')
    expect(latest).toHaveTextContent('You chose: Haskell')
    expect(latest).toHaveTextContent('Your choice matched the correct option.')
    const stored = backend.node('node-a').attempts
    expect(stored.map((a) => [a.chosenOption, a.correct])).toEqual([
      [0, true],
      [1, false],
    ])
  })
})
