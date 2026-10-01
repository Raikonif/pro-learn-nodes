import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { useAgentsStore } from '../agents-store'

import AgentSettingsButton from './AgentSettingsButton'
import AgentSettingsPanel from './AgentSettingsPanel'

const CODEX_PRESET = {
  key: 'codex',
  name: 'Codex',
  command: 'npx',
  args: ['@agentclientprotocol/codex-acp'],
  loginHint: 'Run `codex login` in a terminal.',
}

const CLAUDE_PRESET = {
  key: 'claude',
  name: 'Claude',
  command: 'npx',
  args: ['@agentclientprotocol/claude-agent-acp'],
  loginHint: 'Run `claude`, then `/login`.',
}

const CODEX = {
  id: 'agent-codex',
  name: 'Codex',
  command: 'npx',
  args: ['@agentclientprotocol/codex-acp'],
  env: {},
  isDefault: true,
}

const CLAUDE = {
  id: 'agent-claude',
  name: 'Claude',
  command: 'npx',
  args: ['@agentclientprotocol/claude-agent-acp'],
  env: {},
  isDefault: false,
}

type Route = { method: string; path: string; status?: number; body?: unknown }

function json(body: unknown, status = 200): Response {
  return status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * A tiny fake backend: each route answers with the last body registered for
 * it, so a test can change what `GET /agents` returns after a mutation.
 */
function fakeBackend(routes: Route[]) {
  const table = new Map(routes.map((r) => [`${r.method} ${r.path}`, r]))
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const route = table.get(`${init?.method ?? 'GET'} ${url}`)
    if (!route) return Promise.resolve(json({ detail: 'Not Found' }, 404))
    return Promise.resolve(json(route.body, route.status ?? 200))
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    set(route: Route) {
      table.set(`${route.method} ${route.path}`, route)
    },
  }
}

function openPanel() {
  render(
    <>
      <AgentSettingsButton />
      <AgentSettingsPanel />
    </>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Agent settings' }))
  return screen.getByRole('dialog', { name: 'Agents' })
}

beforeEach(() => {
  useAgentsStore.getState().discard()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AgentSettingsPanel', () => {
  it('opens from the header button and lists registered agents with the default marked', async () => {
    fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [CODEX, CLAUDE], presets: [CODEX_PRESET] } },
    ])

    const dialog = openPanel()

    const codex = await within(dialog).findByRole('listitem', { name: 'Codex' })
    expect(within(codex).getByText('Default')).toBeInTheDocument()
    const claude = within(dialog).getByRole('listitem', { name: 'Claude' })
    expect(within(claude).queryByText('Default')).not.toBeInTheDocument()
    expect(within(claude).getByText('npx @agentclientprotocol/claude-agent-acp')).toBeInTheDocument()
  })

  it('says that agents can read sessions and practice and propose memory through Learn Nodes', async () => {
    fakeBackend([{ method: 'GET', path: '/api/agents', body: { agents: [], presets: [] } }])

    const dialog = openPanel()

    expect(within(dialog).getByTestId('agent-context-access')).toHaveTextContent(
      'Agents can read your sessions and practice, and propose memory, through Learn Nodes.',
    )
    await within(dialog).findByText('No agent registered yet.')
  })

  it('says so when no agent is registered', async () => {
    fakeBackend([{ method: 'GET', path: '/api/agents', body: { agents: [], presets: [] } }])

    const dialog = openPanel()

    expect(await within(dialog).findByText('No agent registered yet.')).toBeInTheDocument()
  })

  it('prefills the form from a preset, keeps it editable, and registers the edited values', async () => {
    const backend = fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [], presets: [CODEX_PRESET, CLAUDE_PRESET] } },
      { method: 'POST', path: '/api/agents', body: CODEX },
    ])
    const dialog = openPanel()
    await within(dialog).findByRole('option', { name: 'Codex' })

    fireEvent.change(within(dialog).getByLabelText('Start from'), { target: { value: 'codex' } })

    expect(within(dialog).getByLabelText('Name')).toHaveValue('Codex')
    expect(within(dialog).getByLabelText('Command')).toHaveValue('npx')
    expect(within(dialog).getByLabelText('Arguments (one per line)')).toHaveValue(
      '@agentclientprotocol/codex-acp',
    )
    // Nothing was registered by choosing a preset.
    expect(backend.fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'My Codex' } })
    backend.set({ method: 'GET', path: '/api/agents', body: { agents: [CODEX], presets: [CODEX_PRESET] } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register agent' }))

    await within(dialog).findByRole('listitem', { name: 'Codex' })
    const post = backend.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      name: 'My Codex',
      command: 'npx',
      args: ['@agentclientprotocol/codex-acp'],
    })
  })

  it('registers a custom command', async () => {
    const backend = fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [], presets: [] } },
      { method: 'POST', path: '/api/agents', body: { ...CODEX, name: 'My Agent', command: 'my-agent' } },
    ])
    const dialog = openPanel()
    await within(dialog).findByText('No agent registered yet.')

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'My Agent' } })
    fireEvent.change(within(dialog).getByLabelText('Command'), { target: { value: 'my-agent' } })
    fireEvent.change(within(dialog).getByLabelText('Arguments (one per line)'), {
      target: { value: '--experimental-acp\n' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register agent' }))

    await waitFor(() =>
      expect(backend.fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    )
    const post = backend.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      name: 'My Agent',
      command: 'my-agent',
      args: ['--experimental-acp'],
    })
  })

  it('shows a refused registration inline, naming its stage and message', async () => {
    fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [], presets: [] } },
      {
        method: 'POST',
        path: '/api/agents',
        status: 422,
        body: { detail: { stage: 'launch', message: 'spawn codex-acp ENOENT' } },
      },
    ])
    const dialog = openPanel()
    await within(dialog).findByText('No agent registered yet.')

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Codex' } })
    fireEvent.change(within(dialog).getByLabelText('Command'), { target: { value: 'codex-acp' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register agent' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Registration failed at the launch stage')
    expect(alert).toHaveTextContent('spawn codex-acp ENOENT')
    // The form keeps what was typed so it can be corrected.
    expect(within(dialog).getByLabelText('Command')).toHaveValue('codex-acp')
  })

  it('shows the preset login hint when registration fails at authentication', async () => {
    fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [], presets: [CODEX_PRESET] } },
      {
        method: 'POST',
        path: '/api/agents',
        status: 422,
        body: { detail: { stage: 'authenticate', message: 'Not logged in' } },
      },
    ])
    const dialog = openPanel()
    await within(dialog).findByRole('option', { name: 'Codex' })
    fireEvent.change(within(dialog).getByLabelText('Start from'), { target: { value: 'codex' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register agent' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Run `codex login` in a terminal.')
  })

  it('sets another agent as the default', async () => {
    const backend = fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [CODEX, CLAUDE], presets: [] } },
      { method: 'PUT', path: '/api/agents/agent-claude/default', body: { ...CLAUDE, isDefault: true } },
    ])
    const dialog = openPanel()
    await within(dialog).findByRole('listitem', { name: 'Claude' })

    backend.set({
      method: 'GET',
      path: '/api/agents',
      body: { agents: [{ ...CODEX, isDefault: false }, { ...CLAUDE, isDefault: true }], presets: [] },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make Claude the default' }))

    const claude = within(dialog).getByRole('listitem', { name: 'Claude' })
    expect(await within(claude).findByText('Default')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Make Codex the default' })).toBeInTheDocument()
  })

  it('removes an agent', async () => {
    const backend = fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [CODEX, CLAUDE], presets: [] } },
      { method: 'DELETE', path: '/api/agents/agent-claude', status: 204 },
    ])
    const dialog = openPanel()
    await within(dialog).findByRole('listitem', { name: 'Claude' })

    backend.set({ method: 'GET', path: '/api/agents', body: { agents: [CODEX], presets: [] } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Claude' }))

    await waitFor(() =>
      expect(within(dialog).queryByRole('listitem', { name: 'Claude' })).not.toBeInTheDocument(),
    )
  })

  it('shows a successful test with the agent identity and session support', async () => {
    fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [CODEX], presets: [] } },
      {
        method: 'POST',
        path: '/api/agents/agent-codex/test',
        body: {
          ok: true,
          stage: null,
          message: null,
          agent: { name: 'codex-acp', title: 'Codex', version: '2.0.1' },
          capabilities: { loadSession: true },
          authMethods: [],
        },
      },
    ])
    const dialog = openPanel()
    await within(dialog).findByRole('listitem', { name: 'Codex' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Test Codex' }))

    const status = await within(dialog).findByRole('status')
    expect(status).toHaveTextContent('Connected to Codex 2.0.1.')
    expect(status).toHaveTextContent('loadSession supported')
  })

  it.each([
    ['launch', 'the command could not be started'],
    ['negotiate', 'did not complete the protocol handshake'],
    ['authenticate', 'the agent is not logged in'],
  ] as const)('names the %s stage when a test fails there', async (stage, explanation) => {
    fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [CODEX], presets: [] } },
      {
        method: 'POST',
        path: '/api/agents/agent-codex/test',
        body: {
          ok: false,
          stage,
          message: `boom at ${stage}`,
          agent: null,
          capabilities: null,
          authMethods: [],
        },
      },
    ])
    const dialog = openPanel()
    await within(dialog).findByRole('listitem', { name: 'Codex' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Test Codex' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(`Failed at the ${stage} stage`)
    expect(alert).toHaveTextContent(explanation)
    expect(alert).toHaveTextContent(`boom at ${stage}`)
  })

  it('directs an unauthenticated agent to its own login, as text, with no credential input', async () => {
    fakeBackend([
      { method: 'GET', path: '/api/agents', body: { agents: [CODEX], presets: [CODEX_PRESET] } },
      {
        method: 'POST',
        path: '/api/agents/agent-codex/test',
        body: {
          ok: false,
          stage: 'authenticate',
          message: 'Authentication required',
          agent: { name: 'codex-acp', title: 'Codex', version: '2.0.1' },
          capabilities: { loadSession: true },
          authMethods: [
            { id: 'chat-gpt', name: 'ChatGPT', description: 'Log in with your ChatGPT account' },
            { id: 'api-key', name: 'API key', description: null },
          ],
        },
      },
    ])
    const dialog = openPanel()
    await within(dialog).findByRole('listitem', { name: 'Codex' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Test Codex' }))

    const instructions = await within(dialog).findByTestId('login-instructions')
    expect(instructions).toHaveTextContent('Run `codex login` in a terminal.')
    expect(instructions).toHaveTextContent('ChatGPT — Log in with your ChatGPT account')
    expect(instructions).toHaveTextContent('API key')
    // Guidance only: nothing in the instructions can be typed into.
    expect(within(instructions).queryByRole('textbox')).not.toBeInTheDocument()

    // And nowhere in settings is there a field that would take a secret.
    expect(document.querySelector('input[type="password"]')).toBeNull()
    for (const field of within(dialog).queryAllByRole('textbox')) {
      expect(field).not.toHaveAccessibleName(/key|token|password|secret|credential|env/i)
    }
    const labels = Array.from(dialog.querySelectorAll('label')).map((l) => l.textContent ?? '')
    expect(labels).toEqual(['Start from', 'Name', 'Command', 'Arguments (one per line)'])
  })

  it('closes', async () => {
    fakeBackend([{ method: 'GET', path: '/api/agents', body: { agents: [], presets: [] } }])
    const dialog = openPanel()
    await within(dialog).findByText('No agent registered yet.')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
