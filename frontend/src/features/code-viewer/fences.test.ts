import { describe, expect, it } from 'vitest'

import { codeBlocks, splitFences } from './fences'

const rejoin = (text: string) => splitFences(text).map((s) => s.raw).join('')

describe('splitFences', () => {
  it('splits prose and a closed block, keeping the text exactly', () => {
    const text = 'Here:\n```python\nprint(1)\nprint(2)\n```\nDone.'
    const segments = splitFences(text)

    expect(rejoin(text)).toBe(text)
    expect(segments.map((s) => s.kind)).toEqual(['text', 'code', 'text'])
    const block = segments[1]
    expect(block.kind === 'code' && block.code).toBe('print(1)\nprint(2)')
    expect(block.kind === 'code' && block.language).toBe('python')
  })

  it('treats an unclosed block as running to the end, as while streaming', () => {
    const text = 'Start\n```js\nconst a = 1\n'
    const [, block] = splitFences(text)

    expect(rejoin(text)).toBe(text)
    expect(block.kind === 'code' && block.code).toBe('const a = 1\n')
    expect(block.kind === 'code' && block.close).toBe('')
  })

  it('numbers several blocks and leaves an unknown language null', () => {
    const text = '```\nplain\n```\n\n~~~rust\nfn main() {}\n~~~\n'
    const blocks = codeBlocks(text)

    expect(rejoin(text)).toBe(text)
    expect(blocks.map((b) => [b.index, b.info, b.language])).toEqual([
      [0, '', null],
      [1, 'rust', null],
    ])
  })

  it('leaves text without fences as one segment', () => {
    expect(splitFences('just `inline` code')).toEqual([{ kind: 'text', raw: 'just `inline` code' }])
    expect(splitFences('')).toEqual([])
  })
})
