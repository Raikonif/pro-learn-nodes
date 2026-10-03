import { useEffect } from 'react'

import type { WorkspaceNode } from '../../../shared/lib/workspace-types'
import { selectDefaultAgent, useAgentsStore, type OfferState } from '../../settings'
import { useTurnStore } from '../turn-store'

/** The agent a session runs on, and what it last reported offering. */
export type SessionAgent = {
  id: string
  name: string
  /** `undefined` until the first read of the offer has started. */
  offer: OfferState | undefined
}

/**
 * Resolves the open session's agent — the node's own, else the account's
 * default, which is what its next turn would run on — and keeps its offer
 * loaded. The backend records the offer whenever a session opens, so it is
 * re-read each time a turn in the open thread has settled.
 */
export function useSessionAgent(node: WorkspaceNode | undefined, threadId: string | null): SessionAgent | null {
  const agents = useAgentsStore((s) => s.agents)
  const defaultAgent = useAgentsStore(selectDefaultAgent)
  const ensureOffer = useAgentsStore((s) => s.ensureOffer)
  const refreshOffer = useAgentsStore((s) => s.refreshOffer)
  const agentId = node ? (node.backendAgentId ?? defaultAgent?.id ?? null) : null
  const offer = useAgentsStore((s) => (agentId ? s.offers[agentId] : undefined))
  const settledRun = useTurnStore((s) => {
    const turn = threadId ? s.turns[threadId] : undefined
    return turn?.settled ? turn.runId : null
  })

  useEffect(() => {
    if (agentId) void ensureOffer(agentId)
  }, [agentId, ensureOffer])

  useEffect(() => {
    if (agentId && settledRun !== null) void refreshOffer(agentId)
    // Only a newly settled turn asks again; a changed agent is `ensureOffer`'s.
  }, [settledRun])

  if (!agentId) return null
  const name = agents.find((agent) => agent.id === agentId)?.name ?? 'Agent'
  return { id: agentId, name, offer }
}
