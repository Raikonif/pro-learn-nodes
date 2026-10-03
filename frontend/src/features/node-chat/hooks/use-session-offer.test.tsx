import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { useAgentsStore, type AgentOffer } from '../../settings'

import { useSessionOffer } from './use-session-offer'

const AGENT = { id: 'agent-codex', name: 'Codex', command: 'npx', args: [], env: {}, isDefault: true }

const OFFER: AgentOffer = {
  known: true,
  model: { id: 'model', name: 'Model', current: 'a', values: [{ value: 'a', name: 'A', description: null }] },
  effort: null,
  fast: null,
  mode: null,
  commands: [{ name: 'compact', description: 'Compact the conversation', inputHint: null }],
}

function setOffer(offer: AgentOffer | null) {
  useAgentsStore.setState({
    offers: { [AGENT.id]: { status: offer ? 'ready' : 'loading', offer, error: null } },
  })
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  __resetIdCounter()
  useAgentsStore.getState().discard()
  useAgentsStore.setState({ agents: [AGENT], presets: [], status: 'ready' })
})

afterEach(cleanup)

describe('useSessionOffer', () => {
  it('is null without a node, and for a node the graph does not hold', () => {
    expect(renderHook(() => useSessionOffer(null)).result.current).toBeNull()
    expect(renderHook(() => useSessionOffer('nope')).result.current).toBeNull()
  })

  it('reports the agent, what it offers, its commands and the learner\'s choices', () => {
    setOffer(OFFER)
    useWorkspaceStore.setState({
      graph: {
        ...useWorkspaceStore.getState().graph,
        nodes: useWorkspaceStore
          .getState()
          .graph.nodes.map((n) => (n.id === 'n-haskell' ? { ...n, agentSettings: { model: 'a' } } : n)),
      },
    })
    const view = renderHook(() => useSessionOffer('n-haskell')).result.current
    expect(view).toMatchObject({ agentName: 'Codex', known: true, effort: null })
    expect(view?.model?.values[0].value).toBe('a')
    expect(view?.commands.map((c) => c.name)).toEqual(['compact'])
    expect(view?.chosen).toEqual({ model: 'a', effort: null, fast: null, mode: null })
  })

  it('is not known, and offers nothing, until the agent has been reached', () => {
    setOffer({ ...OFFER, known: false })
    const view = renderHook(() => useSessionOffer('n-haskell')).result.current
    expect(view).toMatchObject({ agentName: 'Codex', known: false, model: null, commands: [] })
  })
})
