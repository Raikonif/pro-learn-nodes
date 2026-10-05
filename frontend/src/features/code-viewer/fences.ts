import { languageOf, type LanguageId } from './languages'

/**
 * A message split into prose and fenced code blocks. Concatenating every
 * segment's `raw` gives the message back exactly — the conversation measures
 * selection offsets against that text, so rendering may colour it but must not
 * add to it or drop from it.
 */
export type MessageSegment =
  | { kind: 'text'; raw: string }
  | {
      kind: 'code'
      raw: string
      /** The opening fence line, its newline included. */
      open: string
      /** The code between the fences. */
      code: string
      /** The closing fence line, if the block was closed (a streaming one may not be yet). */
      close: string
      info: string
      language: LanguageId | null
      /** The block's position among the message's code blocks, from 0. */
      index: number
    }

const OPEN = /^( {0,3})(`{3,}|~{3,})([^\n`]*)$/

/** Splits a message on fenced code blocks (``` or ~~~). An unclosed block runs to the end. */
export function splitFences(text: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  const lines = text.split(/(?<=\n)/)
  let prose = ''
  let index = 0
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const opening = OPEN.exec(line.replace(/\n$/, ''))
    if (!opening) {
      prose += line
      i += 1
      continue
    }
    const fence = opening[2]
    const info = opening[3].trim()
    let code = ''
    let close = ''
    let j = i + 1
    for (; j < lines.length; j += 1) {
      const candidate = lines[j].replace(/\n$/, '').trim()
      if (candidate.startsWith(fence[0].repeat(fence.length)) && /^[`~]+$/.test(candidate)) {
        close = lines[j]
        j += 1
        break
      }
      code += lines[j]
    }
    if (prose) segments.push({ kind: 'text', raw: prose })
    prose = ''
    // The newline before the closing fence belongs to the fence, not the code.
    const body = close && code.endsWith('\n') ? code.slice(0, -1) : code
    const tail = close && code.endsWith('\n') ? `\n${close}` : close
    segments.push({
      kind: 'code',
      raw: line + code + close,
      open: line,
      code: body,
      close: tail,
      info,
      language: languageOf(info),
      index,
    })
    index += 1
    i = j
  }
  if (prose) segments.push({ kind: 'text', raw: prose })
  return segments
}

export type CodeBlock = Extract<MessageSegment, { kind: 'code' }>

export function codeBlocks(text: string): CodeBlock[] {
  return splitFences(text).filter((segment): segment is CodeBlock => segment.kind === 'code')
}
