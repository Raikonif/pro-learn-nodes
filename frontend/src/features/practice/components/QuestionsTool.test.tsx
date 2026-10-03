import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { createFakePracticeBackend, type FakePracticeBackend } from '../practice-fake-backend'
import { usePracticeStore } from '../practice-store'

import QuestionsTool from './QuestionsTool'

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
  render(<QuestionsTool nodeId={nodeId} />)
}

function seedQuestion(prompt: string, referenceAnswer: string | null = null) {
  backend.node('node-a').items.push({
    id: `item-${prompt}`,
    nodeId: 'node-a',
    kind: 'free_response',
    prompt,
    options: [],
    referenceAnswer,
    createdAt: '2026-10-01T09:00:00Z',
    starterCode: null,
    expectedOutput: null,
    authoredBy: null,
    deliveryId: null,
  })
}

async function answer(prompt: string, text: string) {
  const card = screen.getByRole('article', { name: prompt })
  fireEvent.change(within(card).getByRole('textbox'), { target: { value: text } })
  fireEvent.click(within(card).getByRole('button', { name: 'Submit answer' }))
  await within(card).findByText(text)
  return card
}

describe('QuestionsTool — authoring', () => {
  it('creates a free-response question that appears without reopening the node', async () => {
    await renderTool()

    fireEvent.click(screen.getByRole('button', { name: 'Write a question' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
      target: { value: 'Why is IO a monad?' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Reference answer (optional)' }), {
      target: { value: 'Because bind sequences effects.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }))

    expect(await screen.findByRole('article', { name: 'Why is IO a monad?' })).toBeInTheDocument()
    expect(screen.queryByText('This node has no questions yet.')).not.toBeInTheDocument()
    expect(backend.requestsTo('POST', /items$/)[0]?.body).toEqual({
      kind: 'free_response',
      prompt: 'Why is IO a monad?',
      referenceAnswer: 'Because bind sequences effects.',
    })
    expect(backend.requestsTo('GET', /./)).toHaveLength(1)
  })

  it('refuses an empty prompt in place, with the reason, creating nothing', async () => {
    await renderTool()
    backend.refuseNextItem('A question needs a prompt.')

    fireEvent.click(screen.getByRole('button', { name: 'Write a question' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }))

    const form = screen.getByRole('form', { name: 'New question' })
    expect(await within(form).findByRole('alert')).toHaveTextContent('A question needs a prompt.')
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(backend.node('node-a').items).toHaveLength(0)
  })

  it('lists only free-response items', async () => {
    seedQuestion('Free?')
    backend.node('node-a').items.push({
      id: 'mc',
      nodeId: 'node-a',
      kind: 'multiple_choice',
      prompt: 'Choice?',
      options: [
        { text: 'a', correct: true },
        { text: 'b', correct: false },
      ],
      referenceAnswer: null,
      createdAt: '2026-10-01T09:00:00Z',
      starterCode: null,
      expectedOutput: null,
      authoredBy: null,
      deliveryId: null,
    })
    await renderTool()

    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Free?'])
  })
})

describe('QuestionsTool — answering', () => {
  it('shows the recorded answer and reveals the reference only after submitting', async () => {
    seedQuestion('What is a functor?', 'Something you can map over.')
    await renderTool()
    const card = screen.getByRole('article', { name: 'What is a functor?' })
    expect(within(card).queryByText('Something you can map over.')).not.toBeInTheDocument()

    await answer('What is a functor?', 'A box with fmap')

    expect(within(card).getByTestId('latest-attempt')).toHaveTextContent('A box with fmap')
    expect(within(card).getByTestId('reference-answer')).toHaveTextContent(
      'Something you can map over.',
    )
    expect(card).not.toHaveTextContent(/score|correct|incorrect|pass|fail|\d+\s*\/\s*\d+|%/i)
  })

  it('reveals no reference answer for an item that has none', async () => {
    seedQuestion('Open question')
    await renderTool()

    const card = await answer('Open question', 'My thoughts')

    expect(within(card).getByTestId('latest-attempt')).toHaveTextContent('My thoughts')
    expect(within(card).queryByTestId('reference-answer')).not.toBeInTheDocument()
    expect(within(card).queryByText(/reference/i)).not.toBeInTheDocument()
  })

  it('answering again shows the newest attempt and the count, leaving the first intact', async () => {
    seedQuestion('Explain laziness')
    await renderTool()

    await answer('Explain laziness', 'First try')
    const card = await answer('Explain laziness', 'Second try')

    const latest = within(card).getByTestId('latest-attempt')
    expect(latest).toHaveTextContent('Second try')
    expect(latest).not.toHaveTextContent('First try')
    expect(latest).toHaveTextContent('2 attempts')
    const stored = backend.node('node-a').attempts
    expect(stored.map((a) => a.response)).toEqual(['Second try', 'First try'])
    expect(backend.requestsTo('POST', /attempts$/).map((r) => r.body)).toEqual([
      { response: 'First try' },
      { response: 'Second try' },
    ])
  })
})
