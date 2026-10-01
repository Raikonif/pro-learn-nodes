import { create } from 'zustand'

import {
  listAgents,
  registerAgent,
  removeAgent,
  setDefaultAgent,
  testAgent,
  type Agent,
  type AgentPreset,
  type AgentRegistration,
  type ConnectionTest,
} from './agents-api'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The latest connection test for one agent, kept until the next one starts. */
export type AgentTestState =
  | { status: 'pending' }
  | { status: 'done'; result: ConnectionTest }
  | { status: 'error'; message: string }

export type AgentsState = {
  agents: Agent[]
  presets: AgentPreset[]
  status: LoadStatus
  error: string | null
  tests: Record<string, AgentTestState>
  /** Whether the agent settings panel is showing. */
  panelOpen: boolean
  load: () => Promise<void>
  /** Resolves once the backend has launched, negotiated and saved it; rejects otherwise. */
  register: (registration: AgentRegistration) => Promise<Agent>
  remove: (agentId: string) => Promise<void>
  makeDefault: (agentId: string) => Promise<void>
  test: (agentId: string) => Promise<void>
  openPanel: () => void
  closePanel: () => void
  /**
   * Forgets the account's agents. Registrations are account-scoped, so a
   * window that changed account must not keep offering the last one's.
   */
  discard: () => void
}

const EMPTY = {
  agents: [],
  presets: [],
  status: 'idle',
  error: null,
  tests: {},
  panelOpen: false,
} satisfies Partial<AgentsState>

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  ...EMPTY,

  load: async () => {
    set({ status: 'loading', error: null })
    try {
      const { agents, presets } = await listAgents()
      set({ agents, presets, status: 'ready' })
    } catch (error) {
      set({ status: 'error', error: describe(error) })
    }
  },

  register: async (registration) => {
    const agent = await registerAgent(registration)
    // Re-read rather than append: the first registration becomes the default
    // server-side, and the list is what says so.
    await get().load()
    return agent
  },

  remove: async (agentId) => {
    await removeAgent(agentId)
    const { [agentId]: _dropped, ...tests } = get().tests
    set({ tests })
    await get().load()
  },

  makeDefault: async (agentId) => {
    await setDefaultAgent(agentId)
    // Exactly one default per account: the previous one flipped too.
    await get().load()
  },

  test: async (agentId) => {
    set({ tests: { ...get().tests, [agentId]: { status: 'pending' } } })
    try {
      const result = await testAgent(agentId)
      set({ tests: { ...get().tests, [agentId]: { status: 'done', result } } })
    } catch (error) {
      set({ tests: { ...get().tests, [agentId]: { status: 'error', message: describe(error) } } })
    }
  },

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  discard: () => set({ ...EMPTY }),
}))

/** The account's default agent, if one is registered. */
export function selectDefaultAgent(state: AgentsState): Agent | undefined {
  return state.agents.find((agent) => agent.isDefault)
}

/**
 * The preset an agent was most likely registered from, for its login hint.
 * Registrations do not remember their preset, so this matches on what was
 * launched — the command and arguments — and falls back to the name.
 */
export function presetFor(agent: Pick<Agent, 'name' | 'command' | 'args'>, presets: AgentPreset[]) {
  const sameLaunch = presets.find(
    (preset) =>
      preset.command === agent.command &&
      preset.args.length === agent.args.length &&
      preset.args.every((arg, index) => arg === agent.args[index]),
  )
  return sameLaunch ?? presets.find((preset) => preset.name === agent.name)
}
