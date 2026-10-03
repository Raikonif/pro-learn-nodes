import { create } from 'zustand'

import {
  authorItem,
  loadExerciseBuffer,
  loadNodePractice,
  saveSandbox,
  submitAttempt,
  type AttemptDraft,
  type CodeSubmission,
  type ItemDraft,
  type PracticeAttempt,
  type PracticeItem,
} from './practice-api'
import { EMPTY_ARRANGEMENT, readArrangements, writeArrangements, type Arrangement } from './workbench/arrangement'
import type { BlockKey } from './workbench/blocks'

/** The kinds of practice as the turn stream and the recorded conversation name them. */
export type DeliveredTool = 'code' | 'qa' | 'quiz'

/** What to bring into view: a node's block, with the delivered items in it. */
export type PracticeReveal = { nodeId: string; block: BlockKey; itemIds: string[] }

/** A block opened from the add control to write into: its form starts open. */
export type AuthoringRequest = { nodeId: string; block: BlockKey; seq: number }

/**
 * One node's practice material. `failed` is a state of its own so a tool can
 * say "could not be loaded" instead of "no questions yet".
 */
export type NodeMaterial =
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; items: PracticeItem[]; attempts: PracticeAttempt[] }

/** Where a buffer stands against the backend's copy. */
export type SandboxSaveStatus = 'pending' | 'saving' | 'saved' | 'failed'

/** A code exercise's buffer that has not arrived (yet, or at all). */
export type BufferLoad = { status: 'loading' } | { status: 'failed'; reason: string }

/** Items to highlight, briefly, after a delivery. `seq` tells one reveal from the next. */
export type PracticeHighlight = { nodeId: string; itemIds: string[]; seq: number }

/**
 * How long typing must pause before the buffer is written. The spec requires
 * persistence without a save control, not a write per keystroke (design.md
 * "Persistence goes through the backend").
 */
export const SANDBOX_SAVE_DELAY_MS = 500

/** How long delivered items stay highlighted. */
export const PRACTICE_HIGHLIGHT_MS = 4000

/**
 * Where a buffer lives in `buffers`: the node's free buffer under the node id
 * itself, a code exercise's under the node and the item.
 */
export function bufferKey(nodeId: string, itemId?: string | null): string {
  return itemId ? `${nodeId}#${itemId}` : nodeId
}

function splitKey(key: string): { nodeId: string; itemId: string | undefined } {
  const at = key.indexOf('#')
  return at < 0 ? { nodeId: key, itemId: undefined } : { nodeId: key.slice(0, at), itemId: key.slice(at + 1) }
}

export type PracticeState = {
  /**
   * How each node's workbench is arranged. A view preference of this device:
   * kept in local storage, never sent to the backend or written into node data.
   */
  arrangements: Record<string, Arrangement>
  material: Record<string, NodeMaterial>
  /** When each node's free buffer was last saved, as the backend reported it — orders the scratch block. */
  scratchUpdatedAt: Record<string, string | null>
  /** Code per buffer (see `bufferKey`) — owned here, not by the sandbox component. */
  buffers: Record<string, string>
  sandboxSave: Record<string, SandboxSaveStatus>
  /** Exercise buffers being read, or whose read failed. */
  bufferLoads: Record<string, BufferLoad>
  highlight: PracticeHighlight | null
  authoring: AuthoringRequest | null
  /** Expands one block (collapsing the one that was); `null` collapses everything. */
  expandBlock: (nodeId: string, block: BlockKey | null) => void
  /** Hides a block from the list; nothing in it changes. */
  closeBlock: (nodeId: string, block: BlockKey) => void
  /** Opens a block — reopening it if closed, listing it even while empty — and expands it. */
  openBlock: (nodeId: string, block: BlockKey, options?: { author?: boolean }) => void
  /** The authoring request was acted on. */
  consumeAuthoring: () => void
  /** Reads (or re-reads, as a retry) a node's practice material. */
  load: (nodeId: string) => Promise<void>
  /** Reads an exercise's buffer unless it is already held. Never rejects. */
  openExerciseBuffer: (nodeId: string, itemId: string) => Promise<void>
  /** Resolves with the created item; rejects with the refusal's reason, changing nothing. */
  author: (nodeId: string, draft: ItemDraft) => Promise<PracticeItem>
  /** Records an attempt and shows it at once — no refetch of the node. */
  answer: (nodeId: string, itemId: string, draft: AttemptDraft) => Promise<PracticeAttempt>
  /** Writes the exercise's pending edit, then records the submission as an attempt. */
  submitExercise: (nodeId: string, itemId: string, submission: CodeSubmission) => Promise<PracticeAttempt>
  /** Updates a buffer now and schedules its write. Without `itemId`, the free buffer. */
  editSandbox: (nodeId: string, code: string, itemId?: string) => void
  /** Writes a pending edit immediately; nothing is sent when nothing is pending. */
  flushSandbox: (nodeId: string, itemId?: string) => Promise<void>
  /** Writes every pending edit of the node — its free buffer and each exercise's. */
  flushNode: (nodeId: string) => Promise<void>
  /**
   * Brings delivered practice into view: re-reads the node, reopens and
   * expands its block, and highlights the items for a few seconds.
   */
  reveal: (reveal: PracticeReveal) => void
  /** Forgets everything — the material belongs to the account that loaded it. */
  discard: () => void
}

// Module-level, not state: none of it is ever rendered.
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Buffers whose local copy holds an edit the backend has not confirmed. */
const unsaved = new Set<string>()
/** Latest load per node, so a slow earlier read cannot overwrite a newer one. */
const loadTokens = new Map<string, number>()
let highlightTimer: ReturnType<typeof setTimeout> | undefined
let highlightSeq = 0

function clearTimer(key: string): void {
  const timer = saveTimers.get(key)
  if (timer !== undefined) clearTimeout(timer)
  saveTimers.delete(key)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const usePracticeStore = create<PracticeState>((set, get) => {
  function updateReady(
    nodeId: string,
    update: (ready: Extract<NodeMaterial, { status: 'ready' }>) => NodeMaterial,
  ): void {
    const current = get().material[nodeId]
    if (current?.status !== 'ready') return
    set({ material: { ...get().material, [nodeId]: update(current) } })
  }

  function setSaveStatus(key: string, status: SandboxSaveStatus): void {
    set({ sandboxSave: { ...get().sandboxSave, [key]: status } })
  }

  async function flushKey(key: string): Promise<void> {
    clearTimer(key)
    if (!unsaved.has(key)) return
    const { nodeId, itemId } = splitKey(key)
    const code = get().buffers[key] ?? ''
    setSaveStatus(key, 'saving')
    try {
      await saveSandbox(nodeId, code, itemId)
    } catch {
      // Stays unsaved: the next edit or flush tries again.
      if (get().buffers[key] === code) setSaveStatus(key, 'failed')
      return
    }
    // Typing may have continued while the write was in flight; that newer
    // code is still unsaved and its own timer will write it.
    if (get().buffers[key] === code) {
      unsaved.delete(key)
      setSaveStatus(key, 'saved')
    }
  }

  function arrange(nodeId: string, change: (current: Arrangement) => Arrangement): void {
    const current = get().arrangements[nodeId] ?? EMPTY_ARRANGEMENT
    const arrangements = { ...get().arrangements, [nodeId]: change(current) }
    set({ arrangements })
    writeArrangements(arrangements)
  }

  function show(current: Arrangement, block: BlockKey): Arrangement {
    return { ...current, expanded: block, closed: current.closed.filter((key) => key !== block) }
  }

  return {
    arrangements: readArrangements(),
    material: {},
    scratchUpdatedAt: {},
    buffers: {},
    sandboxSave: {},
    bufferLoads: {},
    highlight: null,
    authoring: null,

    expandBlock: (nodeId, block) => arrange(nodeId, (current) => ({ ...current, expanded: block })),

    closeBlock: (nodeId, block) =>
      arrange(nodeId, (current) => ({
        ...current,
        // With no choice stored, the block being closed is the one shown by
        // default; closing it should leave everything collapsed, not promote
        // the next block into its place.
        expanded: current.expanded === block || current.expanded === undefined ? null : current.expanded,
        closed: current.closed.includes(block) ? current.closed : [...current.closed, block],
      })),

    openBlock: (nodeId, block, options) => {
      arrange(nodeId, (current) => ({
        ...show(current, block),
        opened: current.opened[block] ? current.opened : { ...current.opened, [block]: new Date().toISOString() },
      }))
      if (options?.author) {
        highlightSeq += 1
        set({ authoring: { nodeId, block, seq: highlightSeq } })
      }
    },

    consumeAuthoring: () => set({ authoring: null }),

    load: async (nodeId) => {
      const token = (loadTokens.get(nodeId) ?? 0) + 1
      loadTokens.set(nodeId, token)
      // A node already on screen stays on screen while it refreshes.
      if (get().material[nodeId]?.status !== 'ready') {
        set({ material: { ...get().material, [nodeId]: { status: 'loading' } } })
      }

      const result = await loadNodePractice(nodeId)
      if (loadTokens.get(nodeId) !== token) return

      if (result.status === 'failed') {
        if (get().material[nodeId]?.status === 'ready') return
        set({
          material: { ...get().material, [nodeId]: { status: 'failed', reason: result.reason } },
        })
        return
      }

      const { items, attempts, sandbox } = result.material
      set({
        material: { ...get().material, [nodeId]: { status: 'ready', items, attempts } },
        scratchUpdatedAt: { ...get().scratchUpdatedAt, [nodeId]: sandbox.updatedAt },
        // An edit not yet written is newer than anything the backend holds.
        buffers: unsaved.has(nodeId) ? get().buffers : { ...get().buffers, [nodeId]: sandbox.code },
      })
    },

    openExerciseBuffer: async (nodeId, itemId) => {
      const key = bufferKey(nodeId, itemId)
      if (get().buffers[key] !== undefined || get().bufferLoads[key]?.status === 'loading') return
      set({ bufferLoads: { ...get().bufferLoads, [key]: { status: 'loading' } } })
      let outcome: { code: string } | { reason: string }
      try {
        outcome = { code: (await loadExerciseBuffer(nodeId, itemId)).code }
      } catch (error) {
        outcome = { reason: describe(error) }
      }
      // Discarded (account change) while the read was in flight.
      if (get().bufferLoads[key]?.status !== 'loading') return
      const { [key]: _done, ...bufferLoads } = get().bufferLoads
      if ('reason' in outcome) {
        set({ bufferLoads: { ...bufferLoads, [key]: { status: 'failed', reason: outcome.reason } } })
        return
      }
      set({
        bufferLoads,
        // An edit typed while the read was in flight is newer.
        buffers: unsaved.has(key) ? get().buffers : { ...get().buffers, [key]: outcome.code },
      })
    },

    author: async (nodeId, draft) => {
      const created = await authorItem(nodeId, draft)
      updateReady(nodeId, (ready) => ({ ...ready, items: [...ready.items, created] }))
      return created
    },

    answer: async (nodeId, itemId, draft) => {
      const recorded = await submitAttempt(itemId, draft)
      // Attempts are newest first; a new one never replaces an old one.
      updateReady(nodeId, (ready) => ({ ...ready, attempts: [recorded, ...ready.attempts] }))
      return recorded
    },

    submitExercise: async (nodeId, itemId, submission) => {
      // The agent reads the solution from the buffer's file mirror: what was
      // submitted should be what it finds there.
      await flushKey(bufferKey(nodeId, itemId))
      return get().answer(nodeId, itemId, submission)
    },

    editSandbox: (nodeId, code, itemId) => {
      const key = bufferKey(nodeId, itemId)
      unsaved.add(key)
      set({ buffers: { ...get().buffers, [key]: code } })
      setSaveStatus(key, 'pending')
      clearTimer(key)
      saveTimers.set(
        key,
        setTimeout(() => void flushKey(key), SANDBOX_SAVE_DELAY_MS),
      )
    },

    flushSandbox: (nodeId, itemId) => flushKey(bufferKey(nodeId, itemId)),

    flushNode: async (nodeId) => {
      const keys = [...unsaved].filter((key) => splitKey(key).nodeId === nodeId)
      await Promise.all(keys.map((key) => flushKey(key)))
    },

    reveal: ({ nodeId, block, itemIds }) => {
      highlightSeq += 1
      const seq = highlightSeq
      if (highlightTimer !== undefined) clearTimeout(highlightTimer)
      highlightTimer = setTimeout(() => {
        if (get().highlight?.seq === seq) set({ highlight: null })
      }, PRACTICE_HIGHLIGHT_MS)
      set({ highlight: { nodeId, itemIds, seq } })
      arrange(nodeId, (current) => show(current, block))
      // The delivered items were written by another connection; re-read so
      // they are on screen.
      void get().load(nodeId)
    },

    discard: () => {
      for (const key of [...saveTimers.keys()]) clearTimer(key)
      if (highlightTimer !== undefined) clearTimeout(highlightTimer)
      highlightTimer = undefined
      unsaved.clear()
      loadTokens.clear()
      // The arrangement stays: it is this device's view of node ids, and
      // another account never sees those nodes.
      set({
        material: {},
        scratchUpdatedAt: {},
        buffers: {},
        sandboxSave: {},
        bufferLoads: {},
        highlight: null,
        authoring: null,
      })
    },
  }
})
