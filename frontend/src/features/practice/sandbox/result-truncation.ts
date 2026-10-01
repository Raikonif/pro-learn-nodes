import type { OutputChunk } from './sandbox-protocol'

/**
 * What the result region renders at most. A program printing in a loop can
 * produce far more than a narrow rail can usefully show — or than the DOM can
 * cheaply hold — so the leading part is kept and the cut is stated.
 *
 * Whichever limit is reached first applies.
 */
export const RESULT_DISPLAY_MAX_CHARS = 50_000
export const RESULT_DISPLAY_MAX_LINES = 2_000

export type TruncatedOutput = {
  chunks: OutputChunk[]
  truncated: boolean
}

export function truncateOutput(
  chunks: OutputChunk[],
  maxChars: number = RESULT_DISPLAY_MAX_CHARS,
  maxLines: number = RESULT_DISPLAY_MAX_LINES,
): TruncatedOutput {
  const kept: OutputChunk[] = []
  let chars = 0
  let lines = 0

  for (let i = 0; i < chunks.length; i += 1) {
    const { stream, text } = chunks[i]
    let end = Math.min(text.length, maxChars - chars)
    // Count line breaks inside the allowed span; stop right after the last
    // permitted one.
    let from = 0
    while (lines < maxLines) {
      const at = text.indexOf('\n', from)
      if (at === -1 || at >= end) break
      lines += 1
      from = at + 1
    }
    if (lines >= maxLines) end = Math.min(end, from)

    if (end > 0) kept.push({ stream, text: text.slice(0, end) })
    chars += end

    if (end < text.length) return { chunks: kept, truncated: true }
    if (chars >= maxChars || lines >= maxLines) {
      const more = chunks.slice(i + 1).some((chunk) => chunk.text.length > 0)
      return { chunks: kept, truncated: more }
    }
  }
  return { chunks: kept, truncated: false }
}
