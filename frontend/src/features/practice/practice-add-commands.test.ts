import { beforeEach, describe, expect, it } from 'vitest'

import { openPracticeBlock, practiceAddCommands } from './index'
import { usePracticeStore } from './practice-store'

beforeEach(() => usePracticeStore.getState().discard())

describe('practiceAddCommands', () => {
  it('lists the add control\'s entries in its order, with what each writes and asks', () => {
    expect(practiceAddCommands.map((c) => [c.kind, c.write.label, c.ask.command])).toEqual([
      ['code', 'Open scratch code', '/code '],
      ['quiz', 'Write a quiz question', '/quiz '],
      ['qa', 'Write a question', '/qa '],
    ])
  })
})

describe('openPracticeBlock', () => {
  it('opens the block and asks its form to open when authoring', () => {
    openPracticeBlock('n-1', 'mine:quiz', { author: true })
    expect(usePracticeStore.getState().authoring).toMatchObject({ nodeId: 'n-1', block: 'mine:quiz' })
  })

  it('does not ask for the form when not authoring', () => {
    openPracticeBlock('n-1', 'scratch', { author: false })
    expect(usePracticeStore.getState().authoring).toBeNull()
  })
})
