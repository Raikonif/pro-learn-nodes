import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { WorkspaceNode } from '../../../shared/lib/workspace-types'
import { useAgentsStore } from '../../settings'
import { useSessionStore } from '../session-store'
import { useTurnStore } from '../turn-store'

import NodeConversation from './NodeConversation'

const CODEX = {
  id: 'agent-codex',
  name: 'Codex',
  command: 'npx',
  args: ['@agentclientprotocol/codex-acp'],
  env: {},
  isDefault: true,
}

const OFFER = {
  known: true,
  model: {
    id: 'model',
    name: 'Model',
    current: 'gpt-6-sol',
    values: [
      { value: 'gpt-6-sol', name: 'GPT-6 Sol', description: null },
      { value: 'gpt-6-luna', name: 'GPT-6 Luna', description: 'Lighter and quicker' },
    ],
  },
  effort: {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    current: 'medium',
    values: [
      { value: 'medium', name: 'Medium', description: null },
      { value: 'high', name: 'High', description: null },
    ],
  },
  fast: {
    id: 'fast-mode',
    name: 'Fast mode',
    current: 'off',
    values: [
      { value: 'on', name: 'On', description: null },
      { value: 'off', name: 'Off', description: null },
    ],
  },
  mode: {
    id: 'mode',
    name: 'Mode',
    current: 'agent',
    values: [
      { value: 'read-only', name: 'Read only', description: 'Reads, never writes', group: 'asks' },
      { value: 'agent', name: 'Agent', description: 'Asks before acting', group: 'asks' },
      { value: 'workspace-write', name: 'Workspace write', description: null, group: 'edits' },
      { value: 'agent-full-access', name: 'Full access', description: 'Anything, unasked', group: 'unasked' },
      { value: 'mystery', name: 'Mystery', description: null },
    ],
  },
  commands: [
    { name: 'compact', description: 'Summarise the conversation to free context', inputHint: null },
    { name: '$archify', description: 'Draw an architecture diagram', inputHint: null },
    { name: 'status', description: null, inputHint: null },
  ],
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function controllableStream() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    body,
    async emit(event: string, data: unknown) {
      await act(async () => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    async close() {
      controller.close()
      await flush()
    },
  }
}

type Stream = ReturnType<typeof controllableStream>

/** Serves the agent's offer and the turn route; everything else is a 404. */
function fakeBackend({ offer = OFFER as unknown, streams = [] as Stream[] } = {}) {
  const queue = [...streams]
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/agents/agent-codex/offer') {
      return Promise.resolve(new Response(JSON.stringify(offer), { status: 200 }))
    }
    if (url === '/api/chat/turn' && init?.method === 'POST') {
      const next = queue.shift()
      if (!next) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(new Response(next.body, { status: 200 }))
    }
    return Promise.resolve(new Response('{"detail":"Not Found"}', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function offerReads(fetchMock: ReturnType<typeof fakeBackend>) {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/agents/agent-codex/offer').length
}

function turnBodies(fetchMock: ReturnType<typeof fakeBackend>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/chat/turn')
    .map(([, init]) => JSON.parse(init?.body as string))
}

const STARTED = {
  turnId: 'turn-1',
  threadId: 't-haskell-main',
  learnerMessageId: 'm-live-learner',
  agentMessageId: 'm-live-agent',
}

/** Records every settings change while still applying it to the fixture graph. */
const saved: unknown[] = []
const originalSave = useWorkspaceStore.getState().setNodeAgentSettings

function patchHaskell(change: Partial<WorkspaceNode>) {
  const { graph } = useWorkspaceStore.getState()
  useWorkspaceStore.setState({
    graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === 'n-haskell' ? { ...n, ...change } : n)) },
  })
}

function haskell() {
  return useWorkspaceStore.getState().graph.nodes.find((n) => n.id === 'n-haskell')!
}

async function openHaskell() {
  useWorkspaceStore.getState().openNode('n-haskell')
  const view = render(<NodeConversation />)
  await flush()
  return view
}

async function openSettings() {
  await openHaskell()
  fireEvent.click(screen.getByRole('button', { name: /Session settings/ }))
}

function select(name: RegExp | string) {
  return screen.getByRole('combobox', { name }) as HTMLSelectElement
}

async function choose(name: RegExp | string, value: string) {
  fireEvent.change(select(name), { target: { value } })
  await flush()
}

function marker() {
  return screen.queryByTestId('acts-unasked-marker')
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await flush()
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useTurnStore.getState().reset()
  useSessionStore.getState().reset()
  useAgentsStore.getState().discard()
  useAgentsStore.setState({ agents: [CODEX], presets: [], status: 'ready' })
  __resetIdCounter()
  saved.length = 0
  useWorkspaceStore.setState({
    setNodeAgentSettings: (nodeId, patch) => {
      saved.push(patch)
      return originalSave(nodeId, patch)
    },
  })
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  useTurnStore.getState().reset()
  useWorkspaceStore.setState({ setNodeAgentSettings: originalSave })
  vi.unstubAllGlobals()
})

describe('Session settings — model, effort and fast mode (4.2)', () => {
  it('says the choices appear once the agent has been reached, and offers none', async () => {
    fakeBackend({ offer: { known: false, model: null, effort: null, fast: null, mode: null, commands: [] } })
    await openSettings()

    expect(screen.getByText(/Choices appear once the agent has been reached/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('offers only the models the agent reported, by their names, beside the agent default', async () => {
    fakeBackend()
    await openSettings()

    const options = within(select('Model')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Agent default (GPT-6 Sol)', 'GPT-6 Sol', 'GPT-6 Luna — Lighter and quicker'])
  })

  it('records a chosen model on the session, and returns it to the agent default with null', async () => {
    fakeBackend()
    await openSettings()

    await choose('Model', 'gpt-6-luna')
    expect(haskell().agentSettings).toEqual({ model: 'gpt-6-luna' })
    expect(select('Model').value).toBe('gpt-6-luna')

    await choose('Model', '')
    expect(saved).toEqual([{ model: 'gpt-6-luna' }, { model: null }])
    expect(haskell().agentSettings).toEqual({})
  })

  it('records an effort and turns fast mode on with the agent\'s own value', async () => {
    fakeBackend()
    await openSettings()

    await choose('Effort', 'high')
    const fast = screen.getByRole('switch', { name: 'Fast' })
    expect(fast).not.toBeChecked()
    fireEvent.click(fast)
    await flush()

    expect(saved).toEqual([{ effort: 'high' }, { fast: 'on' }])
    expect(screen.getByRole('switch', { name: 'Fast' })).toBeChecked()
  })

  it('keeps a chosen value the agent no longer offers visible as such', async () => {
    fakeBackend()
    patchHaskell({ agentSettings: { model: 'gpt-5' } })
    await openSettings()

    expect(within(select('Model')).getByRole('option', { name: 'gpt-5 (no longer offered)' })).toBeDisabled()
  })

  it('shows the backend\'s reason when it refuses a choice', async () => {
    fakeBackend()
    useWorkspaceStore.setState({
      setNodeAgentSettings: async () => {
        const { ApiHttpError } = await import('../../../shared/lib/api-client')
        throw new ApiHttpError('HTTP 422', 422, { detail: 'gpt-7 is not offered by Codex' })
      },
    })
    await openSettings()

    await choose('Model', 'gpt-6-luna')

    expect(screen.getByRole('alert')).toHaveTextContent('gpt-7 is not offered by Codex')
  })
})

describe('Session settings — permission modes (4.2)', () => {
  it('groups the modes by what they allow, with each one\'s description', async () => {
    fakeBackend()
    await openSettings()

    const groups = within(select('Permissions')).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual([
      'Asks before acting',
      "Edits this session's folder without asking",
      'Acts on your system without asking',
    ])
    expect(within(groups[0]).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Read only — Reads, never writes',
      'Agent — Asks before acting',
    ])
    expect(within(groups[2]).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Full access — Anything, unasked',
      'Mystery',
    ])
  })

  it('applies a mode that asks with no confirmation', async () => {
    fakeBackend()
    await openSettings()

    await choose('Permissions', 'read-only')

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(saved).toEqual([{ mode: 'read-only' }])
    expect(marker()).toBeNull()
  })

  it('asks before a mode that acts without asking, and sends nothing when cancelled', async () => {
    fakeBackend()
    await openSettings()

    await choose('Permissions', 'agent-full-access')

    const dialog = screen.getByRole('alertdialog', { name: 'Let the agent act without asking?' })
    expect(dialog).toHaveTextContent('may act on your system without asking')
    expect(saved).toEqual([])
    expect(select('Permissions').value).toBe('')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await flush()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(saved).toEqual([])
    expect(marker()).toBeNull()
  })

  it('applies it only once confirmed, and marks the session while it is active', async () => {
    fakeBackend()
    await openSettings()

    await choose('Permissions', 'agent-full-access')
    fireEvent.click(screen.getByRole('button', { name: 'Allow acting without asking' }))
    await flush()

    expect(saved).toEqual([{ mode: 'agent-full-access', confirmedUnasked: true }])
    expect(marker()).toHaveTextContent('Acts without asking')

    // Still marked with the settings folded away.
    fireEvent.click(screen.getByRole('button', { name: /Session settings/ }))
    expect(marker()).toBeInTheDocument()
  })

  it('treats a mode it does not recognise as acting without asking', async () => {
    fakeBackend()
    await openSettings()

    await choose('Permissions', 'mystery')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allow acting without asking' }))
    await flush()

    expect(saved).toEqual([{ mode: 'mystery', confirmedUnasked: true }])
    expect(marker()).toBeInTheDocument()
  })

  it('marks a session whose agent\'s own default acts without asking, from its recorded state', async () => {
    fakeBackend()
    patchHaskell({
      agentState: { model: 'opus', effort: null, fast: null, mode: 'auto', modeGroup: 'unasked' },
    })
    await openHaskell()

    expect(marker()).toBeInTheDocument()
  })

  it('marks a session before any turn when the agent\'s reported default acts without asking', async () => {
    fakeBackend({ offer: { ...OFFER, mode: { ...OFFER.mode, current: 'agent-full-access' } } })
    await openHaskell()

    expect(marker()).toBeInTheDocument()
  })

  it('follows the mode the running turn reports, over what the last turn ran with', async () => {
    const stream = controllableStream()
    fakeBackend({ streams: [stream] })
    patchHaskell({
      agentState: { model: null, effort: null, fast: null, mode: 'auto', modeGroup: 'unasked' },
    })
    await openHaskell()
    expect(marker()).toBeInTheDocument()

    await sendMessage('Hello')
    await stream.emit('turn.started', STARTED)
    await stream.emit('session.state', { model: 'gpt-6-sol', effort: null, fast: 'off', mode: 'agent', modeGroup: 'asks' })
    expect(marker()).toBeNull()

    await stream.emit('session.state', { model: 'gpt-6-sol', effort: null, fast: 'off', mode: 'auto', modeGroup: 'unasked' })
    expect(marker()).toBeInTheDocument()
  })
})

describe('Session settings — notices of choices no longer offered (4.2)', () => {
  it('shows a recorded settings notice as a notice', async () => {
    fakeBackend()
    const { graph } = useWorkspaceStore.getState()
    useWorkspaceStore.setState({
      graph: {
        ...graph,
        messages: [
          ...graph.messages,
          {
            id: 'm-notice',
            threadId: 't-haskell-main',
            role: 'agent',
            content: 'The chosen model gpt-5 is no longer offered; the agent default was used.',
            createdAt: '2026-10-03T10:00:00.000Z',
            kind: 'settings_notice',
            outcome: null,
          },
        ],
      },
    })
    await openHaskell()

    expect(screen.getByTestId('settings-notice')).toHaveTextContent('gpt-5 is no longer offered')
  })

  it('shows a streamed notice live, once, and still once after the turn settles', async () => {
    const stream = controllableStream()
    fakeBackend({ streams: [stream] })
    await openHaskell()

    await sendMessage('Hello')
    await stream.emit('turn.started', STARTED)
    const notice = { messageId: 'm-live-notice', text: 'The chosen model gpt-5 is no longer offered.' }
    await stream.emit('settings.notice', notice)
    await stream.emit('settings.notice', notice)
    expect(screen.getAllByTestId('settings-notice')).toHaveLength(1)

    await stream.emit('text', { text: 'Hi' })
    await stream.emit('turn.ended', { outcome: 'completed', reason: null })
    await stream.close()

    expect(screen.getAllByTestId('settings-notice')).toHaveLength(1)
    expect(screen.getByTestId('settings-notice')).toHaveTextContent('gpt-5 is no longer offered')
  })
})

describe('Context usage (4.4)', () => {
  it('shows nothing until the agent reports usage, then keeps it current during the turn', async () => {
    const stream = controllableStream()
    fakeBackend({ streams: [stream] })
    await openHaskell()
    expect(screen.queryByTestId('context-usage')).toBeNull()

    await sendMessage('Hello')
    await stream.emit('turn.started', STARTED)
    await stream.emit('context.usage', { used: 17140, size: 258400 })
    expect(screen.getByTestId('context-usage')).toHaveTextContent('Context 17k / 258k')
    expect(screen.getByRole('meter', { name: 'Context used' })).toHaveAttribute('value', '17140')

    await stream.emit('context.usage', { used: 20596, size: 258400 })
    expect(screen.getByTestId('context-usage')).toHaveTextContent('Context 21k / 258k')

    await stream.emit('turn.ended', { outcome: 'completed', reason: null })
    await stream.close()
    expect(screen.getByTestId('context-usage')).toHaveTextContent('Context 21k / 258k')
  })
})

describe('The offer follows the agent (4.1)', () => {
  it('reads the offer once on opening and again after a turn ends', async () => {
    const stream = controllableStream()
    const fetchMock = fakeBackend({ streams: [stream] })
    await openHaskell()
    expect(offerReads(fetchMock)).toBe(1)

    await sendMessage('Hello')
    await stream.emit('turn.started', STARTED)
    await stream.emit('text', { text: 'Hi' })
    await stream.emit('turn.ended', { outcome: 'completed', reason: null })
    await stream.close()

    expect(offerReads(fetchMock)).toBe(2)
  })
})

describe('Composer — the agent\'s commands (4.3)', () => {
  function messageBox() {
    return screen.getByRole('textbox', { name: 'Message' })
  }

  function type(text: string) {
    fireEvent.change(messageBox(), { target: { value: text } })
  }

  it('lists the agent\'s commands under its name, beside Learn Nodes\' own', async () => {
    fakeBackend()
    await openHaskell()

    type('/')
    const list = screen.getByRole('listbox', { name: 'Commands' })
    const learnNodes = within(list).getByRole('group', { name: 'Learn Nodes' })
    const codex = within(list).getByRole('group', { name: 'Codex' })
    expect(within(learnNodes).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('/code'),
      expect.stringContaining('/qa'),
      expect.stringContaining('/quiz'),
    ])
    expect(within(codex).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '/compactSummarise the conversation to free context',
      '/$archifyDraw an architecture diagram',
      '/status',
    ])
  })

  it('filters across both lists as the learner types', async () => {
    fakeBackend()
    await openHaskell()

    type('/co')
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual([expect.stringContaining('/code'), expect.stringContaining('/compact')])
  })

  it('inserts an agent command exactly as announced', async () => {
    fakeBackend()
    await openHaskell()

    type('/arch')
    fireEvent.keyDown(messageBox(), { key: 'Enter' })

    expect(messageBox()).toHaveValue('/$archify ')
  })

  it('sends an agent command as an ordinary message, with no command beside it', async () => {
    const stream = controllableStream()
    const fetchMock = fakeBackend({ streams: [stream] })
    await openHaskell()

    type('/comp')
    fireEvent.keyDown(messageBox(), { key: 'Tab' })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()

    expect(turnBodies(fetchMock)).toEqual([{ threadId: 't-haskell-main', text: '/compact' }])
  })

  it('offers only Learn Nodes\' commands while the agent has not been reached', async () => {
    fakeBackend({ offer: { known: false, model: null, effort: null, fast: null, mode: null, commands: [] } })
    await openHaskell()

    type('/')
    expect(screen.getByRole('listbox', { name: 'Practice commands' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Codex' })).toBeNull()
  })
})

describe('A completed turn with no reply', () => {
  it('names the command that ran instead of showing an empty answer', async () => {
    const stream = controllableStream()
    fakeBackend({ streams: [stream] })
    await openHaskell()

    await sendMessage('/compact')
    await stream.emit('turn.started', STARTED)
    await stream.emit('turn.ended', { outcome: 'completed', reason: null })
    expect(screen.getByTestId('empty-agent-reply')).toHaveTextContent('Ran /compact')

    await stream.close()
    expect(screen.getByTestId('empty-agent-reply')).toHaveTextContent('Ran /compact')
    expect(screen.queryByTestId('turn-outcome')).toBeNull()
    expect(screen.queryByTestId('turn-failure')).toBeNull()
  })

  it('says the agent finished without a reply after an ordinary message', async () => {
    const stream = controllableStream()
    fakeBackend({ streams: [stream] })
    await openHaskell()

    await sendMessage('Anything?')
    await stream.emit('turn.started', STARTED)
    await stream.emit('turn.ended', { outcome: 'completed', reason: null })
    await stream.close()

    expect(screen.getByTestId('empty-agent-reply')).toHaveTextContent('The agent finished without a reply')
  })
})
