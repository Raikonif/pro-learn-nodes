import { describe, expect, it } from 'vitest'

import { match, PAGE_SIZE, type PaletteNode } from './match'
import type { Command } from './types'

function cmd(id: string, title: string, extra: Partial<Command> = {}): Command {
  return { id, title, group: 'Workspace', run: () => undefined, ...extra }
}

function node(id: string, title: string, lastActivityAt = '2026-01-01T00:00:00Z', archivedAt?: string): PaletteNode {
  return { id, title, lastActivityAt, archivedAt }
}

const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('match — query', () => {
  it('ranks prefix above word start above substring above subsequence', () => {
    const commands = [
      cmd('sub', 'Anewhere'),
      cmd('word', 'Open new thing'),
      cmd('prefix', 'New session'),
      cmd('seq', 'Nice exciting wonder'),
    ]
    expect(ids(match('new', commands, [], null).commands.items)).toEqual(['prefix', 'word', 'sub', 'seq'])
  })

  it('matches characters in order, not adjacent', () => {
    const result = match('nsn', [cmd('a', 'New session')], [], null)
    expect(ids(result.commands.items)).toEqual(['a'])
    expect(match('xyz', [cmd('a', 'New session')], [], null).commands.items).toEqual([])
  })

  it('is case-insensitive and ignores surrounding blanks', () => {
    expect(ids(match('  NEW ', [cmd('a', 'New session')], [], null).commands.items)).toEqual(['a'])
  })

  it('finds a command by group, description or keyword, below any title match', () => {
    const commands = [
      cmd('kw', 'Memory', { keywords: ['remember'] }),
      cmd('desc', 'Agent settings', { description: 'remember agents' }),
      cmd('grp', 'Opus', { group: 'Rememberer' }),
      cmd('title', 'Remember this'),
    ]
    expect(ids(match('remember', commands, [], null).commands.items)).toEqual(['title', 'grp', 'kw', 'desc'])
  })

  it('treats a leading slash or dollar as a sigil, so "compact" is a prefix of "/compact"', () => {
    const commands = [cmd('mid', 'Go compact now'), cmd('slash', '/compact', { group: 'Codex' })]
    expect(ids(match('compact', commands, [], null).commands.items)).toEqual(['slash', 'mid'])
  })

  it('lists available commands before unavailable ones, however they score', () => {
    const commands = [cmd('best', 'Model', { unavailable: 'no' }), cmd('weak', 'Memory old')]
    expect(ids(match('mod', commands, [], null).commands.items)).toEqual(['weak', 'best'])
    expect(ids(match('mo', commands, [], null).commands.items)).toEqual(['weak', 'best'])
  })

  it('breaks ties by shorter title, then by the order given', () => {
    const commands = [cmd('long', 'New session two'), cmd('b', 'New b'), cmd('a', 'New a')]
    expect(ids(match('new', commands, [], null).commands.items)).toEqual(['b', 'a', 'long'])
  })

  it('matches nodes on title only, and never an archived one', () => {
    const nodes = [node('n1', 'Haskell monads'), node('n2', 'Monads archived', undefined, '2026-02-01T00:00:00Z'), node('n3', 'Rust')]
    expect(ids(match('monad', [], nodes, null).nodes.items)).toEqual(['n1'])
  })

  it('returns commands and nodes for one query, each in its own list', () => {
    const result = match('mem', [cmd('c', 'Memory')], [node('n', 'Memory palaces')], null)
    expect(ids(result.commands.items)).toEqual(['c'])
    expect(ids(result.nodes.items)).toEqual(['n'])
  })

  it('caps each list and states how many more matched', () => {
    const commands = Array.from({ length: 11 }, (_, i) => cmd(`c${i}`, `Item ${i}`))
    const nodes = Array.from({ length: 9 }, (_, i) => node(`n${i}`, `Item ${i}`))
    const result = match('item', commands, nodes, null)
    expect(result.commands.items).toHaveLength(PAGE_SIZE)
    expect(result.commands.more).toBe(3)
    expect(result.nodes.items).toHaveLength(PAGE_SIZE)
    expect(result.nodes.more).toBe(1)
  })

  it('has more of 0 when nothing was cut, and empty lists when nothing matched', () => {
    const result = match('zzz', [cmd('a', 'New session')], [node('n', 'Rust')], null)
    expect(result).toEqual({ commands: { items: [], more: 0 }, nodes: { items: [], more: 0 } })
  })
})

describe('match — empty query', () => {
  const commands = [
    cmd('agent', '/compact', { group: 'Codex' }),
    cmd('sess', 'Model: A', { group: 'Session' }),
    cmd('prac', 'Write a quiz', { group: 'Practice' }),
    cmd('ws2', 'Memory'),
    cmd('off', 'Model: B', { group: 'Session', unavailable: 'nope' }),
    cmd('ws1', 'New session'),
  ]

  it('lists only available commands, in group order and given order within a group', () => {
    expect(ids(match('', commands, [], null).commands.items)).toEqual(['ws2', 'ws1', 'prac', 'sess', 'agent'])
    expect(ids(match('   ', commands, [], null).commands.items)).toEqual(['ws2', 'ws1', 'prac', 'sess', 'agent'])
  })

  it('shows the first 8 with the rest counted', () => {
    const many = Array.from({ length: 70 }, (_, i) => cmd(`a${i}`, `/c${i}`, { group: 'Claude' }))
    const result = match('', many, [], null)
    expect(result.commands.items).toHaveLength(8)
    expect(result.commands.more).toBe(62)
  })

  it('follows with up to 5 recent nodes, newest first, without the open one or archived ones', () => {
    const nodes = [
      node('n1', 'one', '2026-01-01T00:00:00Z'),
      node('n2', 'two', '2026-01-02T00:00:00Z'),
      node('n3', 'three', '2026-01-03T00:00:00Z'),
      node('n4', 'four', '2026-01-04T00:00:00Z'),
      node('n5', 'five', '2026-01-05T00:00:00Z'),
      node('n6', 'six', '2026-01-06T00:00:00Z'),
      node('n7', 'seven', '2026-01-07T00:00:00Z'),
      node('arch', 'archived', '2026-01-08T00:00:00Z', '2026-01-09T00:00:00Z'),
    ]
    const result = match('', [], nodes, 'n7')
    expect(ids(result.nodes.items)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2'])
    expect(result.nodes.more).toBe(0)
  })
})
