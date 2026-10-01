import { create } from 'zustand'

import {
  acceptMemory,
  editMemory,
  exportMemory,
  listMemory,
  rejectMemory,
  removeMemory,
  type Memory,
} from './memory-api'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type MemoryState = {
  panelOpen: boolean
  status: LoadStatus
  error: string | null
  pending: Memory[]
  accepted: Memory[]
  openPanel: () => void
  closePanel: () => void
  load: () => Promise<void>
  /**
   * Each decision resolves once the backend has recorded it and the lists are
   * re-read (accepting a revision changes two rows); it rejects otherwise,
   * changing nothing on screen.
   */
  accept: (id: string, text?: string) => Promise<void>
  reject: (id: string) => Promise<void>
  edit: (id: string, text: string) => Promise<void>
  remove: (id: string) => Promise<void>
  exportMarkdown: () => Promise<string>
  /** Forgets the account's memory: it belongs to the account that loaded it. */
  discard: () => void
}

const EMPTY = {
  panelOpen: false,
  status: 'idle',
  error: null,
  pending: [],
  accepted: [],
} satisfies Partial<MemoryState>

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Bumped by `discard`, so a read begun for one account never lands in the next. */
let generation = 0

export const useMemoryStore = create<MemoryState>((set, get) => {
  async function after(action: () => Promise<void>): Promise<void> {
    await action()
    await get().load()
  }

  return {
    ...EMPTY,

    openPanel: () => set({ panelOpen: true }),
    closePanel: () => set({ panelOpen: false }),

    load: async () => {
      const mine = generation
      // The lists already on screen stay while they refresh.
      set({ status: get().status === 'ready' ? 'ready' : 'loading', error: null })
      try {
        const { pending, accepted } = await listMemory()
        if (mine === generation) set({ pending, accepted, status: 'ready' })
      } catch (error) {
        if (mine === generation) set({ status: 'error', error: describe(error) })
      }
    },

    accept: (id, text) => after(() => acceptMemory(id, text)),
    reject: (id) => after(() => rejectMemory(id)),
    edit: (id, text) => after(() => editMemory(id, text)),
    remove: (id) => after(() => removeMemory(id)),
    exportMarkdown: () => exportMemory(),

    discard: () => {
      generation += 1
      set({ ...EMPTY })
    },
  }
})
