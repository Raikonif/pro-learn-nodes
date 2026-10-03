import { describe, expect, it } from 'vitest'

import { parseCommand, suggestCommands, suggestMenu } from './commands'

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

describe('suggestMenu — Learn Nodes and the agent (agent-session-controls 4.3)', () => {
  const AGENT = {
    name: 'Codex',
    commands: [
      { name: 'compact', description: 'Summarise the conversation', inputHint: null },
      { name: '$archify', description: 'Draw an architecture diagram', inputHint: null },
      { name: 'codebase-memory', description: null, inputHint: null },
      { name: 'quiz', description: 'An agent command shadowed by Learn Nodes', inputHint: null },
    ],
  }

  function names(draft: string, agent: typeof AGENT | null = AGENT) {
    return suggestMenu(draft, agent).map((group) => [group.label, group.commands.map((c) => c.name)])
  }

  it('lists Learn Nodes\' commands and the agent\'s under their own headings', () => {
    expect(names('/')).toEqual([
      ['Learn Nodes', ['code', 'qa', 'quiz']],
      ['Codex', ['compact', '$archify', 'codebase-memory']],
    ])
  })

  it('filters across both as the learner types, including names with symbols', () => {
    expect(names('/co')).toEqual([
      ['Learn Nodes', ['code']],
      ['Codex', ['compact', 'codebase-memory']],
    ])
    expect(names('/codebase-')).toEqual([['Codex', ['codebase-memory']]])
    expect(names('/$a')).toEqual([['Codex', ['$archify']]])
  })

  it('finds a skill by its name without the leading $', () => {
    expect(names('/arch')).toEqual([['Codex', ['$archify']]])
  })

  it('offers only Learn Nodes\' commands when the agent has announced none', () => {
    expect(names('/', null)).toEqual([['Learn Nodes', ['code', 'qa', 'quiz']]])
    expect(names('/', { name: 'Codex', commands: [] })).toEqual([['Learn Nodes', ['code', 'qa', 'quiz']]])
  })

  it('suggests nothing once the command is followed by a space, or for plain text', () => {
    expect(names('/compact ')).toEqual([])
    expect(names('hello /co')).toEqual([])
    expect(names('/zzz')).toEqual([])
  })
})
