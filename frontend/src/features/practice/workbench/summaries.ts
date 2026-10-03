import type { PracticeAttempt, PracticeItem } from '../practice-api'

import { latestAttempts, type Block } from './blocks'

/**
 * A block header's status line: what is left to do, readable without
 * expanding the block. It reports only what was computed — correctness for
 * multiple choice and expected-output matches for code — and never a grade.
 */
export function summarize(block: Block, items: PracticeItem[], attempts: PracticeAttempt[], scratchCode = ''): string {
  if (block.kind === 'scratch') {
    const lines = scratchCode.trim() === '' ? 0 : scratchCode.trimEnd().split('\n').length
    return lines === 0 ? 'empty' : lines === 1 ? '1 line' : `${lines} lines`
  }

  const latest = latestAttempts(attempts.filter((a) => block.itemIds.includes(a.itemId)))
  const total = block.itemIds.length
  if (total === 0) return 'nothing yet'

  if (block.kind === 'code') {
    const exercise = items.find((item) => item.id === block.itemIds[0])
    const last = latest.get(block.itemIds[0])
    if (!last) return 'not submitted'
    if (exercise?.expectedOutput != null && last.correct !== null) {
      return last.correct ? 'submitted · output matched' : 'submitted · output did not match'
    }
    return 'submitted'
  }

  const answered = block.itemIds.filter((id) => latest.has(id)).length
  const noun = total === 1 ? 'question' : 'questions'
  if (block.kind === 'quiz') {
    const correct = block.itemIds.filter((id) => latest.get(id)?.correct === true).length
    return answered === 0
      ? `${total} ${noun}`
      : `${total} ${noun} · ${answered}/${total} answered · ${correct} correct`
  }
  return answered === 0 ? `${total} ${noun}` : `${total} ${noun} · ${answered}/${total} answered`
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '')?.trim() ?? text
}

/** What a block is called in its header. */
export function titleOf(block: Block, items: PracticeItem[]): string {
  if (block.kind === 'scratch') return 'Scratch code'
  if (block.key === 'mine:quiz') return 'Your quiz questions'
  if (block.key === 'mine:qa') return 'Your questions'
  // The first question names the block: two deliveries of the same kind must
  // be told apart at a glance, and the count is already in the status line.
  const first = items.find((item) => item.id === block.itemIds[0])
  if (first) return firstLine(first.prompt)
  return block.kind === 'quiz' ? 'Quiz' : 'Questions'
}
