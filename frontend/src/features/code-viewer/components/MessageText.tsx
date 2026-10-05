import { Fragment, useMemo } from 'react'

import { useCodeViewerStore } from '../code-viewer-store'
import { blockKey } from '../code-sources'
import { codeBlocks, splitFences, type CodeBlock } from '../fences'
import { analyze } from '../highlight'
import { LANGUAGE_LABELS } from '../languages'
import { TOKEN_COLORS } from './CodeView'

/**
 * One fenced block as code, inside the message's text. Its text is exactly the
 * block's — fences included, dimmed — because the conversation measures
 * selection offsets against the message's text: colouring may wrap it, never
 * add to it. Line numbers live in the Code tab, not here, for the same reason.
 */
function InlineBlock({ block }: { block: CodeBlock }) {
  const lines = useMemo(() => analyze(block.code, block.language).lines, [block.code, block.language])
  return (
    <span
      data-testid="message-code-block"
      data-language={block.language ?? 'plain'}
      className={`my-1 block overflow-x-auto rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs leading-5 text-gray-900 ${TOKEN_COLORS}`}
    >
      <span className="text-gray-400">{block.open}</span>
      {lines.map((tokens, index) => (
        <Fragment key={index}>
          {index > 0 ? '\n' : null}
          {tokens.map((token, at) => (
            <span key={at} className={token.classes ?? undefined}>
              {token.text}
            </span>
          ))}
        </Fragment>
      ))}
      <span className="text-gray-400">{block.close}</span>
    </span>
  )
}

/** A message's text with its fenced code blocks shown as code; the text itself unchanged. */
export function MessageText({ text }: { text: string }) {
  const segments = useMemo(() => splitFences(text), [text])
  if (!segments.some((segment) => segment.kind === 'code')) return <>{text}</>
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? <Fragment key={index}>{segment.raw}</Fragment> : <InlineBlock key={index} block={segment} />,
      )}
    </>
  )
}

/**
 * "Open in Code" for each code block of a recorded message. Rendered beside
 * the message's text, never inside it.
 */
export function OpenInCodeActions({ nodeId, messageId, text }: { nodeId: string; messageId: string; text: string }) {
  const openInCode = useCodeViewerStore((s) => s.openInCode)
  const blocks = useMemo(() => codeBlocks(text).filter((block) => block.code.trim()), [text])
  if (blocks.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {blocks.map((block) => {
        const kind = block.language ? LANGUAGE_LABELS[block.language] : block.info || 'code'
        const label = blocks.length === 1 ? `Open ${kind} in Code` : `Open block ${block.index + 1} (${kind}) in Code`
        return (
          <button
            key={block.index}
            type="button"
            onClick={() => openInCode(nodeId, blockKey(messageId, block.index))}
            className="rounded border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
