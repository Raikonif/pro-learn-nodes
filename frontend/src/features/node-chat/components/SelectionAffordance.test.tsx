import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { resolveAnchor } from '../../../shared/lib/anchor-resolver'
import { messageById } from '../../../shared/lib/fixtures'
import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { ChatMessage } from '../../../shared/lib/workspace-types'

import SelectionAffordance from './SelectionAffordance'

/** Offsets of `phrase` inside a fixture message, so tests never hand-count. */
function selectionOf(messageId: string, phrase: string) {
  const message = messageById(useWorkspaceStore.getState().graph, messageId)
  if (!message) throw new Error(`Unknown fixture message: ${messageId}`)
  const start = message.content.indexOf(phrase)
  if (start < 0) throw new Error(`Phrase not in ${messageId}: ${phrase}`)
  return { messageId, start, end: start + phrase.length }
}

/** The most recently appended entry. Hand-rolled: tsconfig targets ES2020. */
function last<T>(items: T[]): T {
  const item = items[items.length - 1]
  if (item === undefined) throw new Error('Expected a non-empty collection')
  return item
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  __resetIdCounter()
})

describe('SelectionAffordance', () => {
  it('raises exactly two actions for a selection inside a message', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<SelectionAffordance selection={selectionOf('m-hs-2', 'thunks on the heap')} />)

    const toolbar = screen.getByRole('toolbar', { name: 'Branch from selection' })
    const actions = within(toolbar).getAllByRole('button')
    expect(actions).toHaveLength(2)
    expect(actions.map((b) => b.textContent)).toEqual(['Generate node', 'New chat'])
  })

  it('raises the affordance for learner messages too', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    // m-hs-1 is a learner turn — branching from your own phrasing is allowed.
    render(<SelectionAffordance selection={selectionOf('m-hs-1', 'lazy evaluation')} />)

    expect(within(screen.getByRole('toolbar')).getAllByRole('button')).toHaveLength(2)
  })

  it('raises nothing for a selection outside any message', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(
      <SelectionAffordance selection={{ messageId: 'not-a-message', start: 0, end: 5 }} />,
    )

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('raises nothing for an empty (collapsed) selection', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<SelectionAffordance selection={{ messageId: 'm-hs-2', start: 4, end: 4 }} />)

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('dismisses without creating anything when the selection clears', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const before = structuredClone(useWorkspaceStore.getState().graph)
    const { rerender } = render(
      <SelectionAffordance selection={selectionOf('m-hs-2', 'thunks on the heap')} />,
    )
    expect(screen.getByRole('toolbar')).toBeInTheDocument()

    rerender(<SelectionAffordance selection={null} />)

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(useWorkspaceStore.getState().graph).toEqual(before)
  })

  it('stores the selected text in the anchor rather than deriving it on read', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<SelectionAffordance selection={selectionOf('m-hs-2', 'thunks on the heap')} />)
    click('Generate node')

    const link = last(useWorkspaceStore.getState().graph.links)
    const anchor = link.anchor
    expect(anchor).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(anchor!, 'excerpt')).toBe(true)
    expect(anchor!.excerpt).toBe('thunks on the heap')

    // The stored copy survives its source being rewritten — proof it is a copy
    // and not a slice taken at read time.
    const rewritten: ChatMessage = {
      ...messageById(useWorkspaceStore.getState().graph, 'm-hs-2')!,
      content: 'Completely different text now.',
    }
    expect(resolveAnchor(anchor!, rewritten)).toEqual({
      status: 'stale',
      text: 'thunks on the heap',
    })
  })

  describe('Generate node', () => {
    it('adds a node to the graph with a link carrying the anchor', () => {
      useWorkspaceStore.getState().openNode('n-haskell')
      const nodeCount = useWorkspaceStore.getState().graph.nodes.length
      render(<SelectionAffordance selection={selectionOf('m-hs-2', 'thunks on the heap')} />)

      click('Generate node')

      const { graph } = useWorkspaceStore.getState()
      expect(graph.nodes).toHaveLength(nodeCount + 1)
      const created = last(graph.nodes)
      const link = last(graph.links)
      expect(link.parentId).toBe('n-haskell')
      expect(link.childId).toBe(created.id)
      expect(link.anchor).toEqual({
        messageId: 'm-hs-2',
        start: expect.any(Number),
        end: expect.any(Number),
        excerpt: 'thunks on the heap',
      })
    })

    it('inherits mode, active skills and MCP servers from the source node', () => {
      useWorkspaceStore.getState().openNode('n-haskell')
      render(<SelectionAffordance selection={selectionOf('m-hs-2', 'thunks on the heap')} />)

      click('Generate node')

      const created = last(useWorkspaceStore.getState().graph.nodes)
      expect(created.mode).toBe('Deepen')
      expect(created.activeSkills).toEqual(['study-coach', 'code-explainer'])
      expect(created.mcpServers).toEqual(['filesystem'])
    })

    it('links to the node that owns the thread when branching from a nested thread', () => {
      useWorkspaceStore.getState().openNode('n-haskell')
      // Two levels down: main → thunks → "evaluated at most once".
      useWorkspaceStore.getState().openThread('t-haskell-once')
      render(<SelectionAffordance selection={selectionOf('m-on-2', 'indirection')} />)

      click('Generate node')

      const { graph } = useWorkspaceStore.getState()
      const created = last(graph.nodes)
      const link = last(graph.links)
      expect(link.parentId).toBe('n-haskell')
      expect(link.childId).toBe(created.id)
      // A branch is never attached to a thread id.
      expect(graph.threads.some((t) => t.id === link.parentId)).toBe(false)
    })
  })

  describe('New chat', () => {
    it('creates a thread on the current node and leaves the graph untouched', () => {
      useWorkspaceStore.getState().openNode('n-haskell')
      const before = structuredClone(useWorkspaceStore.getState().graph)
      render(<SelectionAffordance selection={selectionOf('m-hs-4', 'Space leaks')} />)

      click('New chat')

      const { graph } = useWorkspaceStore.getState()
      expect(graph.nodes).toEqual(before.nodes)
      expect(graph.links).toEqual(before.links)
      expect(graph.threads).toHaveLength(before.threads.length + 1)
      const created = last(graph.threads)
      expect(created.nodeId).toBe('n-haskell')
      expect(created.anchor).toEqual({
        messageId: 'm-hs-4',
        start: expect.any(Number),
        end: expect.any(Number),
        excerpt: 'Space leaks',
      })
    })

    it('keeps a thread spawned from a spawned thread on the same node', () => {
      useWorkspaceStore.getState().openNode('n-haskell')
      useWorkspaceStore.getState().openThread('t-haskell-once')
      const nodeCount = useWorkspaceStore.getState().graph.nodes.length
      render(<SelectionAffordance selection={selectionOf('m-on-2', 'indirection')} />)

      click('New chat')

      const { graph } = useWorkspaceStore.getState()
      expect(graph.nodes).toHaveLength(nodeCount)
      expect(last(graph.threads).nodeId).toBe('n-haskell')
    })
  })
})
