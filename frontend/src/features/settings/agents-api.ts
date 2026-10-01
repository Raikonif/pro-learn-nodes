import { z } from 'zod'

import apiClient, { ApiHttpError } from '../../shared/lib/api-client'

/**
 * Wire contract for the agents routes (design.md "Interfaces" → Agents).
 *
 * An agent is registered by the command that launches it. Nothing here names
 * a credential: the agent is installed and authenticated by the learner,
 * through its own mechanism, outside this application.
 */
export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  isDefault: z.boolean(),
})

export type Agent = z.infer<typeof AgentSchema>

/**
 * Data to prefill the registration form — never registered automatically.
 * `key` is kept open-ended so a backend shipping a fourth preset does not fail
 * validation and blank the settings panel.
 */
export const AgentPresetSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  loginHint: z.string(),
})

export type AgentPreset = z.infer<typeof AgentPresetSchema>

export const AgentListSchema = z.object({
  agents: z.array(AgentSchema),
  presets: z.array(AgentPresetSchema),
})

export type AgentList = z.infer<typeof AgentListSchema>

/** Where a connection attempt stopped: the command, the protocol, or the login. */
export const ConnectionStageSchema = z.enum(['launch', 'negotiate', 'authenticate'])
export type ConnectionStage = z.infer<typeof ConnectionStageSchema>

export const AuthMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
})

export type AuthMethod = z.infer<typeof AuthMethodSchema>

export const ConnectionTestSchema = z.object({
  ok: z.boolean(),
  stage: ConnectionStageSchema.nullable(),
  message: z.string().nullable(),
  agent: z
    .object({
      name: z.string(),
      title: z.string().nullable().optional(),
      version: z.string().nullable().optional(),
    })
    .nullable(),
  capabilities: z.object({ loadSession: z.boolean() }).nullable(),
  authMethods: z.array(AuthMethodSchema),
})

export type ConnectionTest = z.infer<typeof ConnectionTestSchema>

export type AgentRegistration = {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

/**
 * A registration the backend refused after trying to launch and negotiate the
 * command. Carries the stage so the form can say *which* step failed — "not
 * installed" and "not logged in" need different fixes.
 */
export class AgentRegistrationError extends Error {
  override readonly name = 'AgentRegistrationError'
  constructor(
    readonly stage: ConnectionStage | null,
    message: string,
  ) {
    super(message)
  }
}

const RegistrationRefusalSchema = z.object({
  detail: z.object({
    stage: ConnectionStageSchema.nullable().optional(),
    message: z.string(),
  }),
})

export function listAgents(): Promise<AgentList> {
  return apiClient.get('/agents', { schema: AgentListSchema })
}

/**
 * Registers an agent. The backend launches and negotiates the command before
 * saving it, so a 422 here is a real connection failure, rethrown as an
 * `AgentRegistrationError` naming its stage. Any other failure propagates.
 */
export async function registerAgent(registration: AgentRegistration): Promise<Agent> {
  try {
    return await apiClient.post('/agents', registration, { schema: AgentSchema })
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 422) {
      const refusal = RegistrationRefusalSchema.safeParse(error.body)
      if (refusal.success) {
        throw new AgentRegistrationError(
          refusal.data.detail.stage ?? null,
          refusal.data.detail.message,
        )
      }
    }
    throw error
  }
}

export function removeAgent(agentId: string): Promise<void> {
  return apiClient
    .delete(`/agents/${encodeURIComponent(agentId)}`, { schema: z.unknown() })
    .then(() => undefined)
}

export function setDefaultAgent(agentId: string): Promise<Agent> {
  return apiClient.put(`/agents/${encodeURIComponent(agentId)}/default`, {}, { schema: AgentSchema })
}

/** Verifies an agent launches, negotiates, and is logged in. Creates no conversation. */
export function testAgent(agentId: string): Promise<ConnectionTest> {
  return apiClient.post(`/agents/${encodeURIComponent(agentId)}/test`, {}, {
    schema: ConnectionTestSchema,
  })
}
