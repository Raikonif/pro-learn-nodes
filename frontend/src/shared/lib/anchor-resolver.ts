import type { ChatMessage, SelectionAnchor } from './workspace-types'

/**
 * Outcome of pointing an anchor at its source message.
 *
 * `text` is always populated, including when the anchor is stale — a branch is
 * never left with nothing to render. The spec is explicit that a branch whose
 * anchor fails to resolve stays reachable and is neither deleted nor hidden;
 * it just gets presented from its stored excerpt and flagged.
 */
export type AnchorResolution =
  | { status: 'resolved'; text: string }
  | { status: 'stale'; text: string }

/**
 * Resolve an anchor against the current text of its source message.
 *
 * Deliberately strict: the excerpt must sit at exactly the recorded offsets.
 * We do not go hunting for the excerpt elsewhere in the message, because a
 * match found at a different position is a guess about intent, and a wrong
 * guess silently re-points a branch at unrelated text. Reporting "stale" and
 * falling back to the stored copy is the honest failure.
 */
export function resolveAnchor(
  anchor: SelectionAnchor,
  message: ChatMessage | undefined,
): AnchorResolution {
  if (!message) {
    return { status: 'stale', text: anchor.excerpt }
  }
  const current = message.content.slice(anchor.start, anchor.end)
  if (current === anchor.excerpt) {
    return { status: 'resolved', text: current }
  }
  return { status: 'stale', text: anchor.excerpt }
}

/** Convenience for call sites that only need the boolean. */
export function isAnchorStale(
  anchor: SelectionAnchor,
  message: ChatMessage | undefined,
): boolean {
  return resolveAnchor(anchor, message).status === 'stale'
}

/**
 * Build an anchor from a selection inside a message.
 *
 * The excerpt is sliced from the message content at the given offsets and
 * stored, so callers cannot accidentally construct an anchor whose excerpt
 * disagrees with its offsets at creation time.
 */
export function createAnchor(
  message: ChatMessage,
  start: number,
  end: number,
): SelectionAnchor {
  return {
    messageId: message.id,
    start,
    end,
    excerpt: message.content.slice(start, end),
  }
}
