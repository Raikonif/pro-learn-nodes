import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiHttpError, ApiValidationError } from '../../shared/lib/api-client'

import {
  AgentRegistrationError,
  listAgents,
  registerAgent,
  removeAgent,
  setDefaultAgent,
  testAgent,
} from './agents-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const AGENT = {
  id: 'agent-1',
  name: 'Codex',
  command: 'npx',
  args: ['@agentclientprotocol/codex-acp'],
  env: {},
  isDefault: true,
}

const PRESET = {
  key: 'codex',
  name: 'Codex',
  command: 'npx',
  args: ['@agentclientprotocol/codex-acp'],
  loginHint: 'Run `codex login` in a terminal.',
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(status === 204 ? new Response(null, { status }) : jsonResponse(body, status)),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('agents api', () => {
  it('lists registered agents and presets', async () => {
    const fetchMock = stubFetch({ agents: [AGENT], presets: [PRESET] })

    const list = await listAgents()

    expect(list).toEqual({ agents: [AGENT], presets: [PRESET] })
    expect(fetchMock).toHaveBeenCalledWith('/api/agents', { method: 'GET' })
  })

  it('rejects a list that does not match the contract', async () => {
    stubFetch({ agents: [{ ...AGENT, isDefault: 'yes' }], presets: [] })

    await expect(listAgents()).rejects.toBeInstanceOf(ApiValidationError)
  })

  it('registers an agent by command, sending no credential field', async () => {
    const fetchMock = stubFetch(AGENT)

    const agent = await registerAgent({ name: 'Codex', command: 'npx', args: ['x'] })

    expect(agent).toEqual(AGENT)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/agents')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ name: 'Codex', command: 'npx', args: ['x'] })
  })

  it('turns a 422 refusal into an error naming the failed stage', async () => {
    stubFetch({ detail: { stage: 'launch', message: 'command not found: codex-acp' } }, 422)

    const error = await registerAgent({ name: 'X', command: 'codex-acp' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AgentRegistrationError)
    expect((error as AgentRegistrationError).stage).toBe('launch')
    expect((error as AgentRegistrationError).message).toBe('command not found: codex-acp')
  })

  it('leaves a 422 without the staged detail as a plain HTTP error', async () => {
    stubFetch({ detail: [{ loc: ['body', 'command'], msg: 'field required' }] }, 422)

    const error = await registerAgent({ name: 'X', command: '' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiHttpError)
  })

  it('removes an agent', async () => {
    const fetchMock = stubFetch(null, 204)

    await expect(removeAgent('agent-1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-1', { method: 'DELETE' })
  })

  it('marks an agent as the default', async () => {
    const fetchMock = stubFetch(AGENT)

    await expect(setDefaultAgent('agent-1')).resolves.toEqual(AGENT)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/agents/agent-1/default')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT')
  })

  it('reads a staged connection test result', async () => {
    const result = {
      ok: false,
      stage: 'authenticate',
      message: 'Not logged in',
      agent: { name: 'codex-acp', title: 'Codex', version: '2.0.1' },
      capabilities: { loadSession: true },
      authMethods: [{ id: 'chat-gpt', name: 'ChatGPT', description: 'Sign in with ChatGPT' }],
    }
    const fetchMock = stubFetch(result)

    await expect(testAgent('agent-1')).resolves.toEqual(result)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/agents/agent-1/test')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
  })
})
