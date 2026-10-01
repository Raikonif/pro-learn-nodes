import { describe, expect, it } from 'vitest'

import { FIXTURE_GRAPH } from '../../../shared/lib/fixtures'
import type { ChatMessage, WorkspaceGraph } from '../../../shared/lib/workspace-types'

import { latestMessageByNode, previewText } from './session-preview'

function message(id: string, threadId: string, content: string, createdAt: string, kind: ChatMessage['kind'] = 'message'): ChatMessage {
  return { id, threadId, role: 'agent', content, createdAt, kind, outcome: 'completed' }
}

describe('latestMessageByNode', () => {
  it('takes the most recent message from any thread of the node', () => {
    // Haskell's newest message is in a nested spawned thread, not its main one.
    expect(latestMessageByNode(FIXTURE_GRAPH).get('n-haskell')?.id).toBe('m-on-2')
    expect(latestMessageByNode(FIXTURE_GRAPH).get('n-cat')?.id).toBe('m-ct-2')
  })

  it('skips tool entries, notices, and messages with no text yet', () => {
    const graph: WorkspaceGraph = {
      ...FIXTURE_GRAPH,
      messages: [
        ...FIXTURE_GRAPH.messages,
        message('m-tool', 't-cat-main', 'Read file', '2026-09-01T00:00:00.000Z', 'tool'),
        message('m-seam', 't-cat-main', 'resumed', '2026-09-01T00:00:01.000Z', 'continuity_seam'),
        message('m-empty', 't-cat-main', '   ', '2026-09-01T00:00:02.000Z'),
      ],
    }

    expect(latestMessageByNode(graph).get('n-cat')?.id).toBe('m-ct-2')
  })

  it('has no entry for a node without messages', () => {
    const graph: WorkspaceGraph = { ...FIXTURE_GRAPH, messages: [] }
    expect(latestMessageByNode(graph).size).toBe(0)
  })
})

describe('previewText', () => {
  it('keeps a short message whole, on one line', () => {
    expect(previewText('Why\n\ndefer   evaluation?')).toBe('Why defer evaluation?')
  })

  it('cuts a long message at a word boundary with an ellipsis', () => {
    const preview = previewText('alpha beta gamma delta epsilon', 18)
    expect(preview).toBe('alpha beta gamma…')
  })
})
