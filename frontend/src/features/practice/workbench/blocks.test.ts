import { describe, expect, it } from 'vitest'

import type { PracticeAttempt, PracticeItem } from '../practice-api'

import { blockForDelivery, blocksOf } from './blocks'
import { summarize, titleOf } from './summaries'

function item(id: string, kind: PracticeItem['kind'], createdAt: string, extra: Partial<PracticeItem> = {}): PracticeItem {
  return {
    id,
    nodeId: 'n1',
    kind,
    prompt: `Prompt ${id}`,
    options: [],
    referenceAnswer: null,
    createdAt,
    starterCode: null,
    expectedOutput: null,
    authoredBy: null,
    deliveryId: null,
    ...extra,
  }
}

const codex = { agentId: 'a1', name: 'Codex' }

function attempt(itemId: string, createdAt: string, extra: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return {
    id: `t-${itemId}-${createdAt}`,
    itemId,
    nodeId: 'n1',
    response: null,
    chosenOption: 0,
    correct: null,
    score: null,
    createdAt,
    runOutcome: null,
    runOutput: null,
    ...extra,
  }
}

describe('blocksOf', () => {
  it('keeps two deliveries of the same kind apart, newest first', () => {
    const items = [
      item('q1', 'multiple_choice', '2026-10-01T10:00', { authoredBy: codex, deliveryId: 'd1' }),
      item('q2', 'multiple_choice', '2026-10-01T10:00', { authoredBy: codex, deliveryId: 'd1' }),
      item('q3', 'multiple_choice', '2026-10-01T11:00', { authoredBy: codex, deliveryId: 'd2' }),
    ]
    const blocks = blocksOf(items, null)
    expect(blocks.map((b) => [b.key, b.itemIds])).toEqual([
      ['delivery:d2', ['q3']],
      ['delivery:d1', ['q1', 'q2']],
    ])
    expect(blocks[0].author).toEqual(codex)
  })

  it('gives every exercise its own block and groups the learner’s own items by kind', () => {
    const items = [
      item('e1', 'code_exercise', '2026-10-01T09:00', { authoredBy: codex, deliveryId: 'd1' }),
      item('e2', 'code_exercise', '2026-10-01T09:01', { authoredBy: codex, deliveryId: 'd1' }),
      item('m1', 'multiple_choice', '2026-10-01T08:00'),
      item('m2', 'multiple_choice', '2026-10-01T08:30'),
      item('f1', 'free_response', '2026-10-01T07:00'),
    ]
    expect(blocksOf(items, null).map((b) => [b.key, b.kind])).toEqual([
      ['exercise:e2', 'code'],
      ['exercise:e1', 'code'],
      ['mine:quiz', 'quiz'],
      ['mine:qa', 'qa'],
    ])
  })

  it('puts an agent’s items with no delivery in a block of their own', () => {
    const items = [item('q1', 'free_response', '2026-10-01T10:00', { authoredBy: codex })]
    expect(blocksOf(items, null)[0].key).toBe('agent:qa:a1')
  })

  it('shows scratch only once it holds code or was opened', () => {
    expect(blocksOf([], { code: '', updatedAt: null })).toEqual([])
    expect(blocksOf([], { code: 'print(1)', updatedAt: '2026-10-01T10:00' })[0].key).toBe('scratch')
    expect(blocksOf([], { code: '', updatedAt: null }, { scratch: '2026-10-01T12:00' })[0]).toMatchObject({
      key: 'scratch',
      latestAt: '2026-10-01T12:00',
    })
  })

  it('lists an own block opened empty, and ignores unknown opened keys', () => {
    const blocks = blocksOf([], null, { 'mine:quiz': '2026-10-01T12:00', 'delivery:gone': '2026-10-01T12:00' })
    expect(blocks.map((b) => [b.key, b.itemIds])).toEqual([['mine:quiz', []]])
  })
})

describe('blockForDelivery', () => {
  it('opens a delivered exercise itself, and questions by their delivery', () => {
    expect(blockForDelivery({ tool: 'code', messageId: 'm', itemIds: ['e1', 'e2'] })).toBe('exercise:e1')
    expect(blockForDelivery({ tool: 'quiz', messageId: 'm', itemIds: ['q1'] })).toBe('delivery:m')
    expect(blockForDelivery({ tool: 'qa', messageId: 'm', itemIds: ['q1'] })).toBe('delivery:m')
  })
})

describe('summarize', () => {
  const quiz = [
    item('q1', 'multiple_choice', 'a', { deliveryId: 'd', authoredBy: codex }),
    item('q2', 'multiple_choice', 'a', { deliveryId: 'd', authoredBy: codex }),
    item('q3', 'multiple_choice', 'a', { deliveryId: 'd', authoredBy: codex }),
  ]

  it('counts answered and correct by each question’s latest attempt', () => {
    const [block] = blocksOf(quiz, null)
    const attempts = [
      attempt('q1', '3', { correct: true }),
      attempt('q2', '2', { correct: false }),
      attempt('q1', '1', { correct: false }),
    ]
    expect(summarize(block, quiz, attempts)).toBe('3 questions · 2/3 answered · 1 correct')
    expect(summarize(block, quiz, [])).toBe('3 questions')
    expect(titleOf(block, quiz)).toBe('Prompt q1')
  })

  it('reports a code exercise’s match only when it names an expected output', () => {
    const exercise = [item('e1', 'code_exercise', 'a', { expectedOutput: '6\n' })]
    const [block] = blocksOf(exercise, null)
    expect(summarize(block, exercise, [])).toBe('not submitted')
    expect(summarize(block, exercise, [attempt('e1', '1', { correct: true })])).toBe('submitted · output matched')

    const open = [item('e2', 'code_exercise', 'a')]
    expect(summarize(blocksOf(open, null)[0], open, [attempt('e2', '1')])).toBe('submitted')
  })

  it('describes scratch by its length', () => {
    const [block] = blocksOf([], { code: 'a\nb\n', updatedAt: 'x' })
    expect(summarize(block, [], [], 'a\nb\n')).toBe('2 lines')
    expect(titleOf(block, [])).toBe('Scratch code')
  })
})
