import type { PracticeAttempt, PracticeAuthor, PracticeItem } from '../practice-api'

/**
 * A block is a unit of work in the workbench, derived from a node's material
 * rather than stored (design.md "A block is derived from material, not
 * stored"): it has no content of its own, only membership, and a second
 * record of membership would drift from the items.
 */
export type BlockKind = 'quiz' | 'qa' | 'code' | 'scratch'

/**
 * `delivery:<id>` — one delivery's questions; `exercise:<itemId>` — one code
 * exercise; `mine:quiz` / `mine:qa` — what the learner wrote; `scratch` — the
 * node's free buffer; `agent:<kind>:<agent>` — an agent's items whose
 * delivery is unknown.
 */
export type BlockKey = string

export const SCRATCH_KEY: BlockKey = 'scratch'
export const MINE_QUIZ_KEY: BlockKey = 'mine:quiz'
export const MINE_QA_KEY: BlockKey = 'mine:qa'

export type Block = {
  key: BlockKey
  kind: BlockKind
  /** Oldest first, as the backend lists them. Empty for scratch and for an own block opened empty. */
  itemIds: string[]
  /** `null` for the learner's own work. */
  author: PracticeAuthor | null
  /** When the block last gained something — what "newest first" sorts by. */
  latestAt: string
}

export type ScratchState = { code: string; updatedAt: string | null }

const KIND_OF_ITEM: Record<PracticeItem['kind'], BlockKind> = {
  multiple_choice: 'quiz',
  free_response: 'qa',
  code_exercise: 'code',
}

function keyOf(item: PracticeItem): BlockKey {
  if (item.kind === 'code_exercise') return `exercise:${item.id}`
  if (item.deliveryId) return `delivery:${item.deliveryId}`
  const kind = KIND_OF_ITEM[item.kind]
  if (item.authoredBy === null) return `mine:${kind}`
  return `agent:${kind}:${item.authoredBy.agentId ?? item.authoredBy.name}`
}

function kindOfKey(key: BlockKey): BlockKind | null {
  if (key === SCRATCH_KEY) return 'scratch'
  if (key === MINE_QUIZ_KEY) return 'quiz'
  if (key === MINE_QA_KEY) return 'qa'
  return null
}

/**
 * The node's blocks, newest first.
 *
 * `opened` names blocks the learner opened that may hold nothing yet — the
 * scratch buffer, or an own block opened to author into — with when they were
 * opened, so an empty block still has a place in the order.
 */
export function blocksOf(
  items: PracticeItem[],
  scratch: ScratchState | null,
  opened: Record<BlockKey, string> = {},
): Block[] {
  const byKey = new Map<BlockKey, Block>()
  for (const item of items) {
    const key = keyOf(item)
    const block = byKey.get(key)
    if (block) {
      block.itemIds.push(item.id)
      if (item.createdAt > block.latestAt) block.latestAt = item.createdAt
    } else {
      byKey.set(key, {
        key,
        kind: KIND_OF_ITEM[item.kind],
        itemIds: [item.id],
        author: item.authoredBy,
        latestAt: item.createdAt,
      })
    }
  }

  const hasScratch = scratch !== null && scratch.code.trim() !== ''
  if (hasScratch || opened[SCRATCH_KEY]) {
    byKey.set(SCRATCH_KEY, {
      key: SCRATCH_KEY,
      kind: 'scratch',
      itemIds: [],
      author: null,
      latestAt: latest(scratch?.updatedAt ?? null, opened[SCRATCH_KEY] ?? null),
    })
  }
  for (const [key, at] of Object.entries(opened)) {
    const kind = kindOfKey(key)
    if (byKey.has(key) || kind === null || kind === 'scratch') continue
    byKey.set(key, { key, kind, itemIds: [], author: null, latestAt: at })
  }

  return [...byKey.values()].sort((a, b) => (a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0))
}

function latest(a: string | null, b: string | null): string {
  if (a === null) return b ?? ''
  if (b === null) return a
  return a > b ? a : b
}

/** The block a delivery opens: the exercise itself, or the delivery's questions. */
export function blockForDelivery(delivery: { tool: 'code' | 'qa' | 'quiz'; messageId: string; itemIds: string[] }): BlockKey {
  if (delivery.tool === 'code' && delivery.itemIds[0]) return `exercise:${delivery.itemIds[0]}`
  return `delivery:${delivery.messageId}`
}

/** The newest attempt per item; attempts arrive newest first. */
export function latestAttempts(attempts: PracticeAttempt[]): Map<string, PracticeAttempt> {
  const latestByItem = new Map<string, PracticeAttempt>()
  for (const attempt of attempts) {
    if (!latestByItem.has(attempt.itemId)) latestByItem.set(attempt.itemId, attempt)
  }
  return latestByItem
}
