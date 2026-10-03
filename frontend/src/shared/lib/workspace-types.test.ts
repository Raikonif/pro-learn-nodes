import { describe, expect, it } from 'vitest'

import { FIXTURE_GRAPH, mainThreadForNode, parentsOf } from './fixtures'
import {
  ChatMessageSchema,
  ChatThreadSchema,
  SelectionAnchorSchema,
  WorkspaceGraphSchema,
  WorkspaceNodeSchema,
  isMainThread,
} from './workspace-types'

describe('WorkspaceGraphSchema', () => {
  it('accepts the fixture graph', () => {
    const result = WorkspaceGraphSchema.safeParse(FIXTURE_GRAPH)
    expect(result.success).toBe(true)
  })

  it('models a shared child with two parents', () => {
    // The case a single `parent_id` column cannot express, and the reason the
    // anchor has to live on the edge rather than on the node.
    expect(parentsOf(FIXTURE_GRAPH, 'n-functors').sort()).toEqual(['n-cat', 'n-haskell'])
  })

  it('gives every node exactly one main thread', () => {
    for (const node of FIXTURE_GRAPH.nodes) {
      const mains = FIXTURE_GRAPH.threads.filter(
        (t) => t.nodeId === node.id && t.anchor === null,
      )
      expect(mains).toHaveLength(1)
      expect(mainThreadForNode(FIXTURE_GRAPH, node.id)).toBeDefined()
    }
  })
})

describe('SelectionAnchorSchema', () => {
  const valid = { messageId: 'm-1', start: 4, end: 10, excerpt: 'thunks' }

  it('accepts a well-formed anchor', () => {
    expect(SelectionAnchorSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an anchor missing excerpt', () => {
    const { excerpt: _excerpt, ...withoutExcerpt } = valid
    const result = SelectionAnchorSchema.safeParse(withoutExcerpt)
    expect(result.success).toBe(false)
  })

  it('rejects an empty excerpt', () => {
    // An empty excerpt would resolve against any message and defeat the
    // staleness check entirely.
    expect(SelectionAnchorSchema.safeParse({ ...valid, excerpt: '' }).success).toBe(false)
  })

  it('rejects an end offset that does not follow start', () => {
    expect(SelectionAnchorSchema.safeParse({ ...valid, start: 10, end: 4 }).success).toBe(false)
    expect(SelectionAnchorSchema.safeParse({ ...valid, start: 4, end: 4 }).success).toBe(false)
  })

  it('rejects a negative offset', () => {
    expect(SelectionAnchorSchema.safeParse({ ...valid, start: -1 }).success).toBe(false)
  })
})

describe('ChatThreadSchema', () => {
  it('accepts a main thread with a null anchor', () => {
    const main = { id: 't-1', nodeId: 'n-1', name: 'main', anchor: null }
    expect(ChatThreadSchema.safeParse(main).success).toBe(true)
    expect(isMainThread(ChatThreadSchema.parse(main))).toBe(true)
  })

  it('treats an anchored thread as spawned, not main', () => {
    const spawned = {
      id: 't-2',
      nodeId: 'n-1',
      name: 'thunks',
      anchor: { messageId: 'm-1', start: 0, end: 6, excerpt: 'thunks' },
    }
    expect(isMainThread(ChatThreadSchema.parse(spawned))).toBe(false)
  })
})

describe('WorkspaceNodeSchema — session history fields', () => {
  const wire = {
    id: 'n-1',
    title: 'Monads',
    mode: 'Explore',
    body: '',
    activeSkills: [],
    mcpServers: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    lastOpenedAt: '2026-09-02T10:00:00.000Z',
  }

  it('reads last activity and title source when the backend sends them', () => {
    const node = WorkspaceNodeSchema.parse({
      ...wire,
      lastActivityAt: '2026-09-03T10:00:00.000Z',
      titleSource: 'provisional',
    })
    expect(node.lastActivityAt).toBe('2026-09-03T10:00:00.000Z')
    expect(node.titleSource).toBe('provisional')
  })

  it('still parses a snapshot from before activity tracking', () => {
    const node = WorkspaceNodeSchema.parse(wire)
    // Falls back to the closest thing that snapshot knew about.
    expect(node.lastActivityAt).toBe(wire.lastOpenedAt)
    expect(node.titleSource).toBe('topic')
  })

  it('refuses an unknown title source', () => {
    expect(WorkspaceNodeSchema.safeParse({ ...wire, titleSource: 'agent' }).success).toBe(false)
  })
})

describe('WorkspaceNodeSchema — agent session controls', () => {
  const wire = {
    id: 'n-1',
    title: 'Monads',
    mode: 'Explore',
    body: '',
    activeSkills: [],
    mcpServers: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    lastOpenedAt: '2026-09-02T10:00:00.000Z',
  }

  it('reads the learner\'s choices and what the session last ran with', () => {
    const node = WorkspaceNodeSchema.parse({
      ...wire,
      agentSettings: { model: 'opus', fast: 'on' },
      agentState: { model: 'opus', effort: 'high', fast: 'on', mode: 'auto', modeGroup: 'unasked' },
    })
    expect(node.agentSettings).toEqual({ model: 'opus', fast: 'on' })
    expect(node.agentState).toEqual({ model: 'opus', effort: 'high', fast: 'on', mode: 'auto', modeGroup: 'unasked' })
  })

  it('reads a node from before session controls as having neither', () => {
    const node = WorkspaceNodeSchema.parse(wire)
    expect(node.agentSettings ?? null).toBeNull()
    expect(node.agentState ?? null).toBeNull()
  })

  it('reads an unrecognised or missing mode group as acting without asking', () => {
    const node = WorkspaceNodeSchema.parse({
      ...wire,
      agentState: { model: null, effort: null, fast: null, mode: 'mystery', modeGroup: 'sideways' },
    })
    expect(node.agentState?.modeGroup).toBe('unasked')
    const bare = WorkspaceNodeSchema.parse({ ...wire, agentState: { mode: 'x' } })
    expect(bare.agentState).toEqual({ model: null, effort: null, fast: null, mode: 'x', modeGroup: 'unasked' })
  })

  it('reads a state with no mode at all as having no group', () => {
    const node = WorkspaceNodeSchema.parse({ ...wire, agentState: { model: 'opus' } })
    expect(node.agentState?.modeGroup).toBeNull()
  })
})

describe('ChatMessageSchema — settings notices', () => {
  it('reads a notice that a choice is no longer offered', () => {
    const message = ChatMessageSchema.parse({
      id: 'm-1',
      threadId: 't-1',
      role: 'agent',
      content: 'The chosen model “gpt-5” is no longer offered; the agent default was used.',
      createdAt: '2026-10-02T10:00:00Z',
      kind: 'settings_notice',
    })
    expect(message.kind).toBe('settings_notice')
  })
})

describe('ChatMessageSchema — delivery records', () => {
  const base = {
    id: 'm-1',
    threadId: 't-1',
    role: 'agent',
    content: 'Codex sent 3 questions to Quiz',
    createdAt: '2026-10-02T10:00:00Z',
  }

  it('reads a delivery with the tool and item ids it carries', () => {
    const message = ChatMessageSchema.parse({
      ...base,
      kind: 'practice_delivered',
      data: { tool: 'quiz', itemIds: ['i-1', 'i-2', 'i-3'] },
    })
    expect(message.kind).toBe('practice_delivered')
    expect(message.data).toEqual({ tool: 'quiz', itemIds: ['i-1', 'i-2', 'i-3'] })
  })

  it('reads a not-delivered notice', () => {
    const message = ChatMessageSchema.parse({ ...base, kind: 'practice_not_delivered', data: { tool: 'code' } })
    expect(message.kind).toBe('practice_not_delivered')
  })

  it('reads a message from before data existed as carrying none', () => {
    expect(ChatMessageSchema.parse(base).data ?? null).toBeNull()
    expect(ChatMessageSchema.parse({ ...base, data: null }).data).toBeNull()
  })
})
