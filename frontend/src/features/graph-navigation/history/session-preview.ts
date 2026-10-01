import type { ChatMessage, WorkspaceGraph } from '../../../shared/lib/workspace-types'

/**
 * Each node's most recent conversation message, across all of its threads.
 *
 * Only `kind: 'message'` with some text counts: a tool entry or a notice is
 * part of the record but not something a learner would recognise a session
 * by, and an agent reply that has not produced text yet has nothing to show.
 * One pass over the messages, so the whole rail costs one walk of the graph.
 */
export function latestMessageByNode(graph: WorkspaceGraph): Map<string, ChatMessage> {
  const nodeOfThread = new Map(graph.threads.map((thread) => [thread.id, thread.nodeId]))
  const latest = new Map<string, ChatMessage>()
  for (const message of graph.messages) {
    if (message.kind !== 'message' || !message.content.trim()) continue
    const nodeId = nodeOfThread.get(message.threadId)
    if (!nodeId) continue
    const current = latest.get(nodeId)
    if (!current || Date.parse(message.createdAt) >= Date.parse(current.createdAt)) {
      latest.set(nodeId, message)
    }
  }
  return latest
}

export const PREVIEW_LENGTH = 80

/** The beginning of a message, on one line, cut at a word where one is near. */
export function previewText(content: string, length = PREVIEW_LENGTH): string {
  const collapsed = content.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= length) return collapsed
  const cut = collapsed.slice(0, length)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > length / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
