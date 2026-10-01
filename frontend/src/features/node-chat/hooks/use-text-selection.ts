import { useEffect, useState } from 'react'

/**
 * A live text selection, expressed in the only terms the domain understands:
 * a message id plus character offsets into that message's content.
 */
export type MessageSelection = {
  messageId: string
  start: number
  end: number
}

/** Marks the element whose text content IS a message's `content` string. */
export const MESSAGE_CONTENT_ATTR = 'data-message-content'

function contentElementOf(node: Node | null): HTMLElement | null {
  if (!node) return null
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
  return element?.closest<HTMLElement>(`[${MESSAGE_CONTENT_ATTR}]`) ?? null
}

/**
 * Translate the document selection into a `MessageSelection`.
 *
 * Offsets are measured with a Range that spans from the start of the content
 * element to the start of the selection, rather than by trusting
 * `Selection.anchorOffset`. That offset is relative to whichever text node the
 * browser happened to land in, and a message paragraph can be split across
 * several text nodes; measuring from the element start is the only reading
 * that matches the offsets stored in a `SelectionAnchor`.
 *
 * Returns null whenever the selection is collapsed, spans two messages, or
 * sits outside any message — all three are "no branch affordance" cases.
 */
export function readSelectionFromDom(): MessageSelection | null {
  const selection = typeof window === 'undefined' ? null : window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const container = contentElementOf(range.startContainer)
  if (!container || container !== contentElementOf(range.endContainer)) return null

  const messageId = container.getAttribute('data-message-id')
  if (!messageId) return null

  const prefix = range.cloneRange()
  prefix.selectNodeContents(container)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  const end = start + range.toString().length
  if (end <= start) return null

  return { messageId, start, end }
}

/**
 * Track the current in-message text selection.
 *
 * Listens on `selectionchange` rather than `mouseup` so that clearing a
 * selection — by click, by keyboard, by anything — dismisses the affordance
 * on its own, which is exactly what the spec requires.
 */
export function useTextSelection(): MessageSelection | null {
  const [selection, setSelection] = useState<MessageSelection | null>(null)

  useEffect(() => {
    const read = () => setSelection(readSelectionFromDom())
    document.addEventListener('selectionchange', read)
    read()
    return () => document.removeEventListener('selectionchange', read)
  }, [])

  return selection
}
