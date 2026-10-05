import { classHighlighter, highlightTree, tagHighlighter, tags } from '@lezer/highlight'

import { parserFor, type LanguageId } from './languages'

/** One run of text on one line, with the token classes that colour it (none for plain text). */
export type Token = { text: string; classes: string | null }

/** A syntax error, located by 1-based line and column, and by offsets into the code. */
export type Diagnostic = { line: number; column: number; from: number; to: number; message: string }

export type Analysis = {
  /** One entry per line of the code, never empty: the empty string is one empty line. */
  lines: Token[][]
  diagnostics: Diagnostic[]
  /** False when the language is not one the viewer parses: plain lines, no diagnostics. */
  recognised: boolean
}

/**
 * `classHighlighter`'s classes, plus functions told apart from other names:
 * the stock highlighter gives a function call or definition the same class as
 * any variable, and the viewer is meant to colour them distinctly.
 */
const highlighter = tagHighlighter([
  { tag: tags.function(tags.variableName), class: 'tok-function' },
  { tag: tags.function(tags.definition(tags.variableName)), class: 'tok-function tok-definition' },
  { tag: tags.function(tags.propertyName), class: 'tok-function' },
  { tag: tags.definition(tags.className), class: 'tok-className tok-definition' },
  { tag: tags.self, class: 'tok-self' },
])

function classesAt(tagList: Parameters<typeof classHighlighter.style>[0]): string | null {
  return highlighter.style(tagList) ?? classHighlighter.style(tagList)
}

/** Line start offsets, so an offset can be turned into a line and column. */
function lineStarts(code: string): number[] {
  const starts = [0]
  for (let i = 0; i < code.length; i += 1) if (code[i] === '\n') starts.push(i + 1)
  return starts
}

function locate(starts: number[], offset: number): { line: number; column: number } {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle] <= offset) low = middle
    else high = middle - 1
  }
  return { line: low + 1, column: offset - starts[low] + 1 }
}

/** Splits classed ranges covering `code` into tokens per line. */
function toLines(code: string, ranges: { from: number; to: number; classes: string | null }[]): Token[][] {
  const lines: Token[][] = [[]]
  const push = (text: string, classes: string | null) => {
    const parts = text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ text: part, classes })
    })
  }
  let at = 0
  for (const range of ranges) {
    if (range.from > at) push(code.slice(at, range.from), null)
    push(code.slice(range.from, range.to), range.classes)
    at = range.to
  }
  if (at < code.length) push(code.slice(at), null)
  return lines
}

export function plainLines(code: string): Token[][] {
  return toLines(code, [])
}

/**
 * Parses `code` once: the coloured tokens of each line, and every place the
 * parser could not make sense of — a syntax error. Nothing is executed or
 * interpreted; this is what a parser can prove, not semantic lint.
 */
export function analyze(code: string, language: LanguageId | null): Analysis {
  if (!language) return { lines: plainLines(code), diagnostics: [], recognised: false }

  const tree = parserFor(language).parse(code)
  const ranges: { from: number; to: number; classes: string | null }[] = []
  highlightTree(tree, { style: classesAt }, (from, to, classes) => {
    ranges.push({ from, to, classes })
  })

  const starts = lineStarts(code)
  const diagnostics: Diagnostic[] = []
  const seen = new Set<number>()
  tree.iterate({
    enter(node) {
      if (!node.type.isError) return
      // An error node may be empty (something missing here) or sit on a line
      // break; mark the nearest visible character, so it can be underlined.
      let from = Math.min(node.from, Math.max(code.length - 1, 0))
      while (from > 0 && code[from] === '\n') from -= 1
      const to = Math.max(Math.min(node.to, code.length), Math.min(from + 1, code.length))
      if (seen.has(from)) return
      seen.add(from)
      diagnostics.push({ ...locate(starts, from), from, to, message: 'Syntax error' })
    },
  })
  diagnostics.sort((a, b) => a.from - b.from)

  return { lines: toLines(code, ranges), diagnostics, recognised: true }
}

/** The lines a diagnostic touches, 1-based. */
export function diagnosticLines(code: string, diagnostics: Diagnostic[]): Set<number> {
  const starts = lineStarts(code)
  const lines = new Set<number>()
  for (const diagnostic of diagnostics) {
    const first = locate(starts, diagnostic.from).line
    const last = locate(starts, Math.max(diagnostic.to - 1, diagnostic.from)).line
    for (let line = first; line <= last; line += 1) lines.add(line)
  }
  return lines
}
