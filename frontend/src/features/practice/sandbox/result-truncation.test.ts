import { describe, expect, it } from 'vitest'

import { truncateOutput } from './result-truncation'

const out = (text: string) => ({ stream: 'stdout' as const, text })
const err = (text: string) => ({ stream: 'stderr' as const, text })

describe('truncateOutput', () => {
  it('keeps output within both limits whole', () => {
    expect(truncateOutput([out('a\n'), err('b\n')], 100, 10)).toEqual({
      chunks: [out('a\n'), err('b\n')],
      truncated: false,
    })
  })

  it('does not report truncation when output ends exactly at a limit', () => {
    expect(truncateOutput([out('a\nb\n')], 100, 2)).toEqual({
      chunks: [out('a\nb\n')],
      truncated: false,
    })
    expect(truncateOutput([out('abcd')], 4, 10)).toEqual({ chunks: [out('abcd')], truncated: false })
  })

  it('cuts after the last permitted line, across chunks', () => {
    expect(truncateOutput([out('1\n2\n'), err('3\n4\n')], 100, 3)).toEqual({
      chunks: [out('1\n2\n'), err('3\n')],
      truncated: true,
    })
  })

  it('cuts at the character limit', () => {
    expect(truncateOutput([out('abc'), err('defg')], 5, 10)).toEqual({
      chunks: [out('abc'), err('de')],
      truncated: true,
    })
  })

  it('reports truncation when a limit is met and more chunks follow', () => {
    expect(truncateOutput([out('a\n'), err('b')], 100, 1)).toEqual({
      chunks: [out('a\n')],
      truncated: true,
    })
  })
})
