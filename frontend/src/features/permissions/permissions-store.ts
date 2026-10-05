import { create } from 'zustand'

import {
  decide as decideRequest,
  listPending,
  listRemembered,
  revoke as revokeDecision,
  type PendingPermission,
  type RememberedPermission,
} from './permissions-api'

/**
 * The account's permission requests and remembered decisions.
 *
 * One store behind both surfaces that answer a request — the inline prompt
 * and the workspace indicator — so answering in one removes it from the
 * other at once, before the next read confirms it.
 */
export type PermissionsState = {
  pending: PendingPermission[]
  remembered: RememberedPermission[]
  rememberedStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Ids being answered right now, so a second click cannot send twice. */
  answering: Record<string, true>
  refreshPending: () => Promise<void>
  /** Answers a request; it leaves the store whether decided here or already elsewhere. */
  decide: (requestId: string, allow: boolean, remember: boolean) => Promise<'decided' | 'gone' | 'busy'>
  /** Drops a request locally — its turn reported it decided, or it ended. */
  forget: (requestId: string) => void
  loadRemembered: () => Promise<void>
  revoke: (id: string) => Promise<void>
  /** Test-only. */
  reset: () => void
}

const initial = {
  pending: [] as PendingPermission[],
  remembered: [] as RememberedPermission[],
  rememberedStatus: 'idle' as const,
  answering: {} as Record<string, true>,
}

// A read started before a decision may answer after it, still listing the
// request; requests answered locally stay hidden until a read omits them.
const answered = new Set<string>()

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  ...initial,

  refreshPending: async () => {
    try {
      const pending = await listPending()
      const listed = new Set(pending.map((request) => request.requestId))
      for (const id of answered) if (!listed.has(id)) answered.delete(id)
      set({ pending: pending.filter((request) => !answered.has(request.requestId)) })
    } catch {
      // Keep what is shown; the next read may succeed.
    }
  },

  decide: async (requestId, allow, remember) => {
    if (get().answering[requestId]) return 'busy'
    set({ answering: { ...get().answering, [requestId]: true } })
    let result: 'decided' | 'gone'
    try {
      result = await decideRequest(requestId, allow, remember)
      get().forget(requestId)
    } finally {
      const { [requestId]: _done, ...rest } = get().answering
      set({ answering: rest })
    }
    if (remember && result === 'decided') void get().loadRemembered()
    return result
  },

  forget: (requestId) => {
    answered.add(requestId)
    set({ pending: get().pending.filter((request) => request.requestId !== requestId) })
  },

  loadRemembered: async () => {
    set({ rememberedStatus: get().rememberedStatus === 'ready' ? 'ready' : 'loading' })
    try {
      set({ remembered: await listRemembered(), rememberedStatus: 'ready' })
    } catch {
      set({ rememberedStatus: 'error' })
    }
  },

  revoke: async (id) => {
    await revokeDecision(id)
    set({ remembered: get().remembered.filter((decision) => decision.id !== id) })
  },

  reset: () => {
    answered.clear()
    set({ ...initial })
  },
}))
