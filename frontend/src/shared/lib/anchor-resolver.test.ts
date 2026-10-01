import { describe, expect, it } from 'vitest'

import { createAnchor, isAnchorStale, resolveAnchor } from './anchor-resolver'
import { FIXTURE_GRAPH, THREAD_FUNCTORS_STALE, messageById } from './fixtures'
import type { ChatMessage } from './workspace-types'

function msg(content: string): ChatMessage {
  return {
    id: 'm-1',
    threadId: 't-1',
    role: 'agent',
    content,
    createdAt: '2026-08-01T00:00:00.000Z',
    kind: 'message',
    outcome: 'completed',
  }
}

describe('resolveAnchor', () => {
  it('resolves when the excerpt still sits at the recorded offsets', () => {
    const source = msg('Haskell holds unevaluated expressions as thunks on the heap.')
    const start = source.content.indexOf('thunks')
    const anchor = createAnchor(source, start, start + 'thunks'.length)

    expect(anchor.excerpt).toBe('thunks')
    expect(resolveAnchor(anchor, source)).toEqual({ status: 'resolved', text: 'thunks' })
    expect(isAnchorStale(anchor, source)).toBe(false)
  })

  it('reports stale and returns the stored excerpt when a correction rewrites the text', () => {
    const original = msg('Haskell holds unevaluated expressions as thunks on the heap.')
    const start = original.content.indexOf('thunks')
    const anchor = createAnchor(original, start, start + 'thunks'.length)

    // Phase 9 rewrites the passage; the offsets now land on different text.
    const corrected = msg('Haskell holds unevaluated expressions as closures on the heap.')

    expect(resolveAnchor(anchor, corrected)).toEqual({ status: 'stale', text: 'thunks' })
    expect(isAnchorStale(anchor, corrected)).toBe(true)
  })

  it('reports stale when compaction removes the source message entirely', () => {
    const original = msg('Unevaluated expressions are held as thunks.')
    const anchor = createAnchor(original, 36, 42)

    expect(resolveAnchor(anchor, undefined)).toEqual({ status: 'stale', text: 'thunks' })
  })

  it('does not re-point the anchor when the excerpt moved elsewhere in the message', () => {
    const original = msg('thunks are suspended computations')
    const anchor = createAnchor(original, 0, 6)

    // The word still exists, but not where the anchor says. Finding it anyway
    // would be a guess about intent; the honest answer is stale.
    const shifted = msg('In Haskell, thunks are suspended computations')

    expect(resolveAnchor(anchor, shifted)).toEqual({ status: 'stale', text: 'thunks' })
  })

  it('always returns text, so a stale branch still has something to render', () => {
    const anchor = { messageId: 'gone', start: 0, end: 5, excerpt: 'lazy' }
    const resolution = resolveAnchor(anchor, undefined)

    expect(resolution.text).toBe('lazy')
    expect(resolution.text.length).toBeGreaterThan(0)
  })
})

describe('createAnchor', () => {
  it('stores the excerpt rather than deriving it on read', () => {
    const source = msg('lazy evaluation defers work')
    const anchor = createAnchor(source, 0, 15)

    expect(anchor).toEqual({
      messageId: 'm-1',
      start: 0,
      end: 15,
      excerpt: 'lazy evaluation',
    })
  })
})

describe('the stale fixture', () => {
  it('exercises the stale path against the real fixture graph', () => {
    const anchor = THREAD_FUNCTORS_STALE.anchor
    expect(anchor).not.toBeNull()

    const source = messageById(FIXTURE_GRAPH, anchor!.messageId)
    expect(source).toBeDefined()

    const resolution = resolveAnchor(anchor!, source)
    expect(resolution.status).toBe('stale')
    expect(resolution.text).toBe('preserving structure and the functor laws')
  })

  it('leaves every other fixture anchor resolvable', () => {
    const stale = FIXTURE_GRAPH.threads
      .filter((t) => t.anchor !== null && t.id !== THREAD_FUNCTORS_STALE.id)
      .filter((t) => resolveAnchor(t.anchor!, messageById(FIXTURE_GRAPH, t.anchor!.messageId)).status === 'stale')

    expect(stale).toEqual([])

    const staleLinks = FIXTURE_GRAPH.links
      .filter((l) => l.anchor !== null)
      .filter((l) => resolveAnchor(l.anchor!, messageById(FIXTURE_GRAPH, l.anchor!.messageId)).status === 'stale')

    expect(staleLinks).toEqual([])
  })
})
