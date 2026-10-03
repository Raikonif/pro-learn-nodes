import { useMemo } from 'react'

import { usePracticeStore } from '../practice-store'

import { EMPTY_ARRANGEMENT } from './arrangement'
import { blocksOf, type Block, type BlockKey } from './blocks'

export type Workbench = {
  /** Open blocks, newest first. */
  blocks: Block[]
  /** Closed blocks, newest first — reachable, never deleted. */
  closed: Block[]
  /** The expanded block's key, or `null` when every block is a header. */
  expanded: BlockKey | null
}

const NONE: Workbench = { blocks: [], closed: [], expanded: null }

/**
 * A node's workbench as the learner sees it: its blocks split into open and
 * closed, and which one is expanded.
 *
 * With no choice made yet (`expanded` undefined), the newest open block is
 * expanded; a stored choice naming a block that no longer exists collapses
 * everything rather than guessing.
 */
export function useWorkbench(nodeId: string | null): Workbench {
  const material = usePracticeStore((s) => (nodeId === null ? undefined : s.material[nodeId]))
  const code = usePracticeStore((s) => (nodeId === null ? undefined : s.buffers[nodeId]))
  const updatedAt = usePracticeStore((s) => (nodeId === null ? null : (s.scratchUpdatedAt[nodeId] ?? null)))
  const arrangement = usePracticeStore((s) =>
    nodeId === null ? EMPTY_ARRANGEMENT : (s.arrangements[nodeId] ?? EMPTY_ARRANGEMENT),
  )

  return useMemo(() => {
    if (material?.status !== 'ready') return NONE
    const all = blocksOf(material.items, { code: code ?? '', updatedAt }, arrangement.opened)
    const closedKeys = new Set(arrangement.closed)
    const blocks = all.filter((block) => !closedKeys.has(block.key))
    const closed = all.filter((block) => closedKeys.has(block.key))
    let expanded: BlockKey | null
    if (arrangement.expanded === undefined) expanded = blocks[0]?.key ?? null
    else expanded = blocks.some((block) => block.key === arrangement.expanded) ? arrangement.expanded : null
    return { blocks, closed, expanded }
  }, [material, code, updatedAt, arrangement])
}

/** Whether a block of the node is expanded — the minimap gives it the height when one is. */
export function useHasExpandedBlock(nodeId: string | null): boolean {
  return useWorkbench(nodeId).expanded !== null
}
