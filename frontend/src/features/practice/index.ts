// Public surface for the practice feature.
// Import this feature only via this file; internal paths are private.
export { default as PracticeRail } from './components/PracticeRail'
export { useHasExpandedBlock } from './workbench/use-workbench'

import { useMemo } from 'react'

import { bufferKey, usePracticeStore, type DeliveredTool } from './practice-store'
import { blockForDelivery, type BlockKey } from './workbench/blocks'
import { ADDABLE_KINDS, BLOCK_KINDS } from './workbench/kinds'

/**
 * Forgets every node's practice material and unsaved buffers held in memory.
 * Called when the account changes, alongside the workspace's own discard, so
 * nothing loaded for one account is kept in the window for the next.
 */
export function discardPracticeState(): void {
  usePracticeStore.getState().discard()
}

export type { DeliveredTool } from './practice-store'

/**
 * Brings a delivery into view: re-reads the node's material, reopens and
 * expands the delivery's block — the exercise itself for `code`, the
 * delivery's questions otherwise — and highlights the items for a few
 * seconds. The caller decides whether the node is the one on screen.
 */
export function revealDelivery(delivery: {
  nodeId: string
  tool: DeliveredTool
  messageId: string
  itemIds: string[]
}): void {
  usePracticeStore.getState().reveal({
    nodeId: delivery.nodeId,
    block: blockForDelivery(delivery),
    itemIds: delivery.itemIds,
  })
}

const TOOL_LABELS: Record<DeliveredTool, string> = { code: 'Code', qa: 'Q&A', quiz: 'Quiz' }

/** The name a delivered kind of practice goes by, for text that leads there. */
export function practiceToolLabel(tool: DeliveredTool): string {
  return TOOL_LABELS[tool]
}

/** One thing the workbench's add control offers, for another surface to offer too. */
export type PracticeAddCommand = {
  /** The kind it is for: `quiz`, `qa` or `code`. Stable, so a command id can be built on it. */
  kind: string
  /** Writing it oneself: the block opened, its form open when `author`. */
  write: { label: string; block: BlockKey; author: boolean }
  /** Asking the agent: the command to place in the composer, e.g. `/quiz `. */
  ask: { label: string; command: string }
}

/**
 * The add control's entries, derived from the block-kind registry so a new
 * kind that offers an add appears in every surface at once.
 */
export const practiceAddCommands: PracticeAddCommand[] = ADDABLE_KINDS.flatMap((kind) => {
  const add = BLOCK_KINDS[kind].add
  return add ? [{ kind, write: add.write, ask: add.ask }] : []
})

/**
 * Opens a block in a node's workbench and expands it, its form open when
 * `author` — what the add control's "write" entries do.
 */
export function openPracticeBlock(nodeId: string, block: BlockKey, options?: { author?: boolean }): void {
  usePracticeStore.getState().openBlock(nodeId, block, options)
}

/** A code exercise as another surface shows it: its statement, starter code, and the learner's current solution. */
export type PracticeCodeExercise = { id: string; prompt: string; starterCode: string; solution: string }

/**
 * The node's code exercises, with the learner's current solution — the buffer
 * as held here, or the starter code when none has been read or written. Only
 * what practice has already loaded for the node; nothing is fetched here.
 */
export function usePracticeCodeExercises(nodeId: string | null): PracticeCodeExercise[] {
  const material = usePracticeStore((s) => (nodeId ? s.material[nodeId] : undefined))
  const buffers = usePracticeStore((s) => s.buffers)
  return useMemo(() => {
    if (!nodeId || material?.status !== 'ready') return []
    return material.items
      .filter((item) => item.kind === 'code_exercise')
      .map((item) => {
        const starterCode = item.starterCode ?? ''
        return { id: item.id, prompt: item.prompt, starterCode, solution: buffers[bufferKey(nodeId, item.id)] ?? starterCode }
      })
  }, [nodeId, material, buffers])
}
