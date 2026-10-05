import { describe, expect, it } from 'vitest'

import { analyze, diagnosticLines } from './highlight'
import { languageOf, languageOfPath } from './languages'

function classesOf(code: string, language: Parameters<typeof analyze>[1], text: string): string | null {
  const token = analyze(code, language)
    .lines.flat()
    .find((t) => t.text === text)
  return token?.classes ?? null
}

describe('analyze', () => {
  const python = [
    'class Greeter:',
    '    def greet(self, name):',
    '        # say hello',
    '        return f"hola {name}" + str(42)',
    '',
  ].join('\n')

  it('keeps every line, in order, with the original text', () => {
    const { lines } = analyze(python, 'python')
    expect(lines.map((line) => line.map((t) => t.text).join(''))).toEqual(python.split('\n'))
  })

  it('colours Python keywords, classes, functions, strings, numbers and comments distinctly', () => {
    const kinds = {
      keyword: classesOf(python, 'python', 'class'),
      className: classesOf(python, 'python', 'Greeter'),
      functionDefinition: classesOf(python, 'python', 'greet'),
      call: classesOf(python, 'python', 'str'),
      number: classesOf(python, 'python', '42'),
      comment: classesOf(python, 'python', '# say hello'),
    }
    expect(kinds.keyword).toContain('tok-keyword')
    expect(kinds.className).toContain('tok-className')
    expect(kinds.functionDefinition).toContain('tok-function')
    expect(kinds.call).toContain('tok-function')
    expect(kinds.number).toContain('tok-number')
    expect(kinds.comment).toContain('tok-comment')
    expect(new Set(Object.values(kinds).map((c) => c?.split(' ')[0])).size).toBeGreaterThanOrEqual(5)
  })

  it('has no diagnostics for code that parses', () => {
    expect(analyze(python, 'python').diagnostics).toEqual([])
    expect(analyze('const x: number = 1\nexport function f() { return x }\n', 'typescript').diagnostics).toEqual([])
    expect(analyze('{"a": [1, 2, true]}', 'json').diagnostics).toEqual([])
  })

  it('marks a syntax error with its line and column', () => {
    const code = 'x = 1\nprint((x\n'
    const { diagnostics } = analyze(code, 'python')
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0].line).toBeGreaterThanOrEqual(2)
    expect(diagnostics[0].message).toBe('Syntax error')
    expect(diagnosticLines(code, diagnostics).has(1)).toBe(false)
  })

  it('reports a JSON syntax error', () => {
    const { diagnostics } = analyze('{"a": 1,, }', 'json')
    expect(diagnostics[0]).toMatchObject({ line: 1 })
  })

  it('shows an unrecognised language as plain lines with no diagnostics', () => {
    const result = analyze('fn main() {\n}\n', null)
    expect(result.recognised).toBe(false)
    expect(result.diagnostics).toEqual([])
    expect(result.lines.flat().every((t) => t.classes === null)).toBe(true)
    expect(result.lines).toHaveLength(3)
  })

  it('handles the empty string as one empty line', () => {
    expect(analyze('', 'python').lines).toEqual([[]])
  })

  it.each(['javascript', 'typescript', 'json', 'html', 'css', 'markdown'] as const)('parses %s', (language) => {
    const samples = {
      javascript: 'function f(a) { return a * 2 } // twice',
      typescript: 'interface P { x: number }\nconst p: P = { x: 1 }',
      json: '{"k": "v"}',
      html: '<div class="a">hi</div>',
      css: '.a { color: red; }',
      markdown: '# Title\n\nSome *text*.',
    }
    const result = analyze(samples[language], language)
    expect(result.recognised).toBe(true)
    expect(result.lines.flat().some((t) => t.classes)).toBe(true)
  })
})

describe('languages', () => {
  it('reads a fence info string or a file extension', () => {
    expect(languageOf('python title="x.py"')).toBe('python')
    expect(languageOf('TSX')).toBe('typescript')
    expect(languageOf('rust')).toBeNull()
    expect(languageOfPath('web/app.mjs')).toBe('javascript')
    expect(languageOfPath('README')).toBeNull()
  })
})
