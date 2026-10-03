import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { AgentCommand, AgentOption, ModeOption } from '../../settings'

import { useSessionAgent } from './use-session-agent'

/** What a node's session offers right now, and what the learner has chosen from it. */
export type SessionOfferView = {
  agentName: string
  /** `false` until the agent has been reached: nothing below is offered yet. */
  known: boolean
  model: AgentOption | null
  effort: AgentOption | null
  fast: AgentOption | null
  mode: ModeOption | null
  /** The commands and skills the agent announced, as announced. */
  commands: AgentCommand[]
  /** The learner's recorded choices for this session; absent ones are `null`. */
  chosen: { model: string | null; effort: string | null; fast: string | null; mode: string | null }
}

/**
 * The open session's offer, for surfaces outside the conversation (the
 * command registry). It resolves the agent and its offer the way the
 * conversation does — `useSessionAgent` — so there is one fetch, shared
 * through the agents store, not a second one. `null` when there is no such
 * node or it has no agent to ask; before the offer has loaded, `known` is
 * `false`.
 */
export function useSessionOffer(nodeId: string | null): SessionOfferView | null {
  const node = useWorkspaceStore((s) => (nodeId ? s.graph.nodes.find((candidate) => candidate.id === nodeId) : undefined))
  const agent = useSessionAgent(node, null)
  if (!node || !agent) return null

  const offer = agent.offer?.offer ?? null
  const known = offer?.known === true
  const settings = node.agentSettings ?? {}
  return {
    agentName: agent.name,
    known,
    model: known ? offer.model : null,
    effort: known ? offer.effort : null,
    fast: known ? offer.fast : null,
    mode: known ? offer.mode : null,
    commands: known ? offer.commands : [],
    chosen: {
      model: settings.model ?? null,
      effort: settings.effort ?? null,
      fast: settings.fast ?? null,
      mode: settings.mode ?? null,
    },
  }
}
