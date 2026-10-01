import { describe, expect, it } from 'vitest'

import { parseCommand, suggestCommands } from './commands'

describe('parseCommand', () => {
  it('reads the command and what is asked for after it', () => {
    expect(parseCommand('/quiz five questions on folds')).toEqual({
      command: 'quiz',
      request: 'five questions on folds',
    })
    expect(parseCommand('/code\nfizzbuzz')).toEqual({ command: 'code', request: 'fizzbuzz' })
  })

  it('reads a bare command as one asking for nothing', () => {
    expect(parseCommand('/qa')).toEqual({ command: 'qa', request: '' })
    expect(parseCommand('/qa   ')).toEqual({ command: 'qa', request: '' })
  })

  it('is not fooled by look-alikes', () => {
    expect(parseCommand('/quizzes please')).toBeNull()
    expect(parseCommand('/help')).toBeNull()
    expect(parseCommand('please /quiz me')).toBeNull()
    expect(parseCommand('quiz me')).toBeNull()
  })
})

describe('suggestCommands', () => {
  it('suggests every command for a lone slash, and narrows as letters follow', () => {
    expect(suggestCommands('/').map((c) => c.name)).toEqual(['code', 'qa', 'quiz'])
    expect(suggestCommands('/q').map((c) => c.name)).toEqual(['qa', 'quiz'])
    expect(suggestCommands('/qu').map((c) => c.name)).toEqual(['quiz'])
  })

  it('suggests nothing once the command is written out with a space, or for plain text', () => {
    expect(suggestCommands('/quiz ')).toEqual([])
    expect(suggestCommands('hello')).toEqual([])
    expect(suggestCommands('/x')).toEqual([])
  })
})
