import { create } from 'zustand'

import { useWorkspaceStore } from '../../shared/lib/workspace-store'

import type { ContextUsage, SessionState } from './chat-api'

/**
 * What the open turns have reported about each session's agent, by node:
 * the state its last turn ran with (`session.state`) and its context usage
 * (`context.usage`). In memory only — a reload forgets it, and the bootstrap's
 * `agentState` stands in for the state until the next turn reports again.
 */
export type SessionReport = {
  state: SessionState | null
  usage: ContextUsage | null
}

type SessionStore = {
  byNode: Record<string, SessionReport>
  record: (nodeId: string, report: Partial<SessionReport>) => void
  /** Drops what a node's previous agent reported — its agent was changed. */
  forget: (nodeId: string) => void
  reset: () => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  byNode: {},
  record: (nodeId, report) => {
    const previous = get().byNode[nodeId] ?? { state: null, usage: null }
    set({ byNode: { ...get().byNode, [nodeId]: { ...previous, ...report } } })
  },
  forget: (nodeId) => {
    const { [nodeId]: _dropped, ...rest } = get().byNode
    set({ byNode: rest })
  },
  reset: () => set({ byNode: {} }),
}))

// What one account's sessions reported is not the next account's to show.
useWorkspaceStore.subscribe((state, previous) => {
  if (state.workspaceId !== previous.workspaceId) useSessionStore.getState().reset()
})

/** The node a thread belongs to, if the graph holds it. */
export function nodeOfThread(threadId: string): string | undefined {
  return useWorkspaceStore.getState().graph.threads.find((thread) => thread.id === threadId)?.nodeId
}
