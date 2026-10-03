import type { BlockKey } from './blocks'

/**
 * How one node's workbench is arranged on this device: a view preference,
 * never node data, and never sent to the backend.
 *
 * `expanded` is `undefined` until the learner (or a delivery) chooses, which
 * means "the newest block"; `null` means they collapsed everything.
 */
export type Arrangement = {
  expanded?: BlockKey | null
  closed: BlockKey[]
  /** Blocks opened while possibly empty, with when — see `blocksOf`. */
  opened: Record<BlockKey, string>
}

export const EMPTY_ARRANGEMENT: Arrangement = { closed: [], opened: {} }

const STORAGE_KEY = 'learn-nodes.workbench'

/**
 * Storage can be absent or throw (a private window, cleared site data); the
 * workbench then starts from its defaults rather than failing to render.
 */
export function readArrangements(): Record<string, Arrangement> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, Arrangement> = {}
    for (const [nodeId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const arrangement = sanitize(value)
      if (arrangement) out[nodeId] = arrangement
    }
    return out
  } catch {
    return {}
  }
}

export function writeArrangements(arrangements: Record<string, Arrangement>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(arrangements))
  } catch {
    // A preference that could not be kept is not worth interrupting anyone for.
  }
}

function sanitize(value: unknown): Arrangement | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const closed = Array.isArray(v.closed) ? v.closed.filter((k): k is string => typeof k === 'string') : []
  const opened: Record<string, string> = {}
  if (typeof v.opened === 'object' && v.opened !== null) {
    for (const [k, at] of Object.entries(v.opened as Record<string, unknown>)) {
      if (typeof at === 'string') opened[k] = at
    }
  }
  const arrangement: Arrangement = { closed, opened }
  if (v.expanded === null || typeof v.expanded === 'string') arrangement.expanded = v.expanded
  return arrangement
}
