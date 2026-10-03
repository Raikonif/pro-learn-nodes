import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { ChatMessage } from '../../../shared/lib/workspace-types'
import { useAgentsStore } from '../../settings'
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

const CLAUDE = { ...CODEX, id: 'agent-claude', name: 'Claude', isDefault: false }

/** Lets pending stream reads, store updates and renders run to completion. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** A turn stream the test writes into, one SSE event at a time. */
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
        // Let the reader pick the chunk up and React render it.
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

/**
 * Answers the turn route with the next prepared stream, and the cancel route
 * with `cancelStatus`. Everything else is a 404.
 */
function fakeBackend(streams: Stream[], cancelStatus = 204) {
  const queue = [...streams]
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/chat/turn' && init?.method === 'POST') {
      const next = queue.shift()
      if (!next) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(
        new Response(next.body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      )
    }
    if (/^\/api\/chat\/turns\/[^/]+\/cancel$/.test(url)) {
      return Promise.resolve(
        cancelStatus === 204
          ? new Response(null, { status: 204 })
          : new Response('{}', { status: cancelStatus }),
      )
    }
    return Promise.resolve(new Response('{"detail":"Not Found"}', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const STARTED = {
  turnId: 'turn-1',
  threadId: 't-haskell-main',
  learnerMessageId: 'm-live-learner',
  agentMessageId: 'm-live-agent',
}

function openHaskell() {
  useWorkspaceStore.getState().openNode('n-haskell')
  return render(<NodeConversation />)
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await flush()
}

function recorded(id: string): ChatMessage | undefined {
  return useWorkspaceStore.getState().graph.messages.find((m) => m.id === id)
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useTurnStore.getState().reset()
  useAgentsStore.getState().discard()
  useAgentsStore.setState({ agents: [CODEX, CLAUDE], presets: [], status: 'ready' })
  __resetIdCounter()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  // Unmount first: resetting the turn store under a mounted conversation is
  // a state update outside any test's act().
  cleanup()
  useTurnStore.getState().reset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('NodeConversation — a streaming turn', () => {
  it('renders the agent turn as text arrives, before the turn ends', async () => {
    const stream = controllableStream()
    const fetchMock = fakeBackend([stream])
    openHaskell()

    await sendMessage('Why are thunks costly?')

    expect(screen.getByText('Why are thunks costly?')).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/chat/turn') ?? []
    expect(JSON.parse(init?.body as string)).toEqual({
      threadId: 't-haskell-main',
      text: 'Why are thunks costly?',
    })

    await stream.emit('turn.started', STARTED)
    await stream.emit('text', { text: 'Each thunk ' })
    await stream.emit('text', { text: 'is a heap allocation.' })

    const live = screen.getByTestId('live-agent-message')
    expect(live).toHaveTextContent('Each thunk is a heap allocation.')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    // Not presented as an answer while it is still arriving.
    expect(within(live).queryByTestId('turn-outcome')).not.toBeInTheDocument()
  })

  it('folds the finished turn into the record without showing it twice', async () => {
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()

    await sendMessage('Why are thunks costly?')
    await stream.emit('turn.started', STARTED)
    await stream.emit('text', { text: 'Heap allocation.' })
    await stream.emit('turn.ended', { outcome: 'completed', reason: null })
    await stream.close()

    await waitFor(() => expect(recorded('m-live-agent')).toBeDefined())
    expect(recorded('m-live-agent')).toMatchObject({ content: 'Heap allocation.', outcome: 'completed' })
    expect(recorded('m-live-learner')).toMatchObject({ content: 'Why are thunks costly?', role: 'learner' })
    expect(screen.getAllByText('Heap allocation.')).toHaveLength(1)
    expect(screen.getAllByText('Why are thunks costly?')).toHaveLength(1)
    // A completed answer carries no outcome label.
    expect(screen.queryByTestId('turn-outcome')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('renders tool activity, a plan, a refused permission and a continuity seam distinctly', async () => {
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()

    await sendMessage('Look at my notes')
    await stream.emit('turn.started', STARTED)
    await stream.emit('continuity.seam', { messageId: 'm-seam', reason: 'session could not be loaded' })
    await stream.emit('plan', {
      entries: [
        { content: 'Read the notes', status: 'in_progress' },
        { content: 'Summarise', status: 'pending' },
      ],
    })
    await stream.emit('tool', {
      messageId: 'm-tool',
      toolCallId: 'call-1',
      title: 'Read notes.md',
      kind: 'read',
      status: 'pending',
    })
    await stream.emit('tool', {
      messageId: 'm-tool',
      toolCallId: 'call-1',
      title: 'Read notes.md',
      kind: 'read',
      status: 'completed',
    })
    await stream.emit('permission.refused', { messageId: 'm-perm', title: 'Edit notes.md' })
    await stream.emit('text', { text: 'Here is a summary.' })

    const tools = screen.getAllByTestId('tool-activity')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toHaveTextContent('Read notes.md')
    expect(tools[0]).toHaveTextContent('completed')
    // Tool activity is not part of the answer text.
    expect(screen.getByTestId('live-agent-message')).not.toHaveTextContent('Read notes.md')

    const plan = screen.getByTestId('agent-plan')
    expect(within(plan).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Read the notes(in_progress)',
      'Summarise(pending)',
    ])

    const refused = screen.getByTestId('permission-refused')
    expect(refused).toHaveTextContent('The agent asked to: Edit notes.md')
    expect(refused).toHaveTextContent('refused')
    expect(refused).toHaveTextContent(/later update/)

    expect(screen.getByTestId('continuity-seam')).toHaveTextContent('session could not be loaded')

    await stream.emit('turn.ended', { outcome: 'completed', reason: null })
    await stream.close()

    // Once settled, the record carries each entry by kind — still one of each.
    await waitFor(() => expect(recorded('m-tool')).toMatchObject({ kind: 'tool' }))
    expect(recorded('m-perm')).toMatchObject({ kind: 'permission_refused', content: 'Edit notes.md' })
    expect(recorded('m-seam')).toMatchObject({ kind: 'continuity_seam' })
    expect(screen.getAllByTestId('tool-activity')).toHaveLength(1)
    expect(screen.getAllByTestId('permission-refused')).toHaveLength(1)
    expect(screen.getAllByTestId('continuity-seam')).toHaveLength(1)
  })

  it('stops a running turn: cancels it, frees the composer at once, keeps the partial answer marked', async () => {
    const stream = controllableStream()
    const fetchMock = fakeBackend([stream])
    openHaskell()

    await sendMessage('Explain space leaks')
    await stream.emit('turn.started', STARTED)
    await stream.emit('text', { text: 'A space leak is' })

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/turns/turn-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
    // Usable immediately — before the agent has confirmed anything.
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Next' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()

    await stream.emit('turn.ended', { outcome: 'cancelled', reason: null })
    await stream.close()

    await waitFor(() => expect(recorded('m-live-agent')?.outcome).toBe('cancelled'))
    expect(screen.getByText('A space leak is')).toBeInTheDocument()
    expect(screen.getByTestId('turn-outcome')).toHaveAttribute('data-outcome', 'cancelled')
    expect(screen.getByTestId('turn-outcome')).toHaveTextContent(/Cancelled/)
  })

  it('drops the stream when the cancel request itself fails, still marking the turn cancelled', async () => {
    const stream = controllableStream()
    fakeBackend([stream], 500)
    openHaskell()

    await sendMessage('Explain space leaks')
    await stream.emit('turn.started', STARTED)
    await stream.emit('text', { text: 'Partial' })

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await flush()

    await waitFor(() => expect(recorded('m-live-agent')?.outcome).toBe('cancelled'))
    expect(screen.getByText('Partial')).toBeInTheDocument()
  })

  it('lets the learner send again while a stopped turn has not confirmed yet', async () => {
    const first = controllableStream()
    const second = controllableStream()
    fakeBackend([first, second])
    openHaskell()

    await sendMessage('First')
    await first.emit('turn.started', STARTED)
    await first.emit('text', { text: 'Half an ans' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await sendMessage('Second')
    await second.emit('turn.started', {
      ...STARTED,
      turnId: 'turn-2',
      learnerMessageId: 'm-2-learner',
      agentMessageId: 'm-2-agent',
    })
    await second.emit('text', { text: 'Second answer' })

    expect(screen.getByTestId('live-agent-message')).toHaveTextContent('Second answer')
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('marks a turn whose connection dropped as incomplete, keeping what arrived', async () => {
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()

    await sendMessage('Go')
    await stream.emit('turn.started', STARTED)
    await stream.emit('text', { text: 'Got this far' })
    await stream.close()

    await waitFor(() => expect(recorded('m-live-agent')?.outcome).toBe('incomplete'))
    expect(screen.getByText('Got this far')).toBeInTheDocument()
    expect(screen.getByTestId('turn-outcome')).toHaveAttribute('data-outcome', 'incomplete')
    expect(screen.getByRole('alert')).toHaveTextContent('connection to this turn was lost')
  })

  it('shows a failed turn and why, distinct from a completed answer', async () => {
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()

    await sendMessage('Go')
    await stream.emit('turn.started', STARTED)
    await stream.emit('text', { text: 'Some content' })
    await stream.emit('turn.ended', {
      outcome: 'failed',
      reason: 'unreachable',
      detail: 'agent process exited with code 1',
    })
    await stream.close()

    const failure = await screen.findByTestId('turn-failure')
    expect(failure).toHaveTextContent('could not be reached')
    expect(failure).toHaveTextContent('agent process exited with code 1')
    expect(screen.getByTestId('turn-outcome')).toHaveAttribute('data-outcome', 'failed')
  })

  it('shows a refused turn as refused', async () => {
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()

    await sendMessage('Go')
    await stream.emit('turn.started', STARTED)
    await stream.emit('turn.ended', { outcome: 'refused', reason: null })
    await stream.close()

    await waitFor(() =>
      expect(screen.getByTestId('turn-outcome')).toHaveAttribute('data-outcome', 'refused'),
    )
  })

  it('directs to agent settings when no agent is registered', async () => {
    useAgentsStore.setState({ agents: [], status: 'ready' })
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()

    await sendMessage('Hello?')
    await stream.emit('turn.started', STARTED)
    await stream.emit('turn.ended', {
      outcome: 'failed',
      reason: 'no_agent',
      detail: 'Register an agent in settings.',
    })
    await stream.close()

    const failure = await screen.findByTestId('turn-failure')
    expect(failure).toHaveTextContent('No agent is registered')
    // The learner's message was recorded even though no turn ran.
    await waitFor(() => expect(recorded('m-live-learner')?.content).toBe('Hello?'))

    fireEvent.click(within(failure).getByRole('button', { name: 'Open agent settings' }))
    expect(useAgentsStore.getState().panelOpen).toBe(true)
  })

  it('reports a request that never reached the backend as failed', async () => {
    fakeBackend([])
    openHaskell()

    await sendMessage('Anyone there?')

    const failure = await screen.findByTestId('turn-failure')
    expect(failure).toHaveTextContent('could not be sent')
    expect(screen.getByText('Anyone there?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })
})

describe('NodeConversation — recorded agent entries', () => {
  function withMessages(messages: ChatMessage[]) {
    const { graph } = useWorkspaceStore.getState()
    useWorkspaceStore.setState({ graph: { ...graph, messages: [...graph.messages, ...messages] } })
  }

  const base = { threadId: 't-haskell-main', createdAt: '2026-09-30T10:00:00.000Z', role: 'agent' as const }

  it('renders tool, refusal and seam records the same way a live turn does', () => {
    withMessages([
      { ...base, id: 'r-seam', kind: 'continuity_seam', content: 'agent switched', outcome: null },
      { ...base, id: 'r-tool', kind: 'tool', content: 'Read notes.md', outcome: null },
      { ...base, id: 'r-perm', kind: 'permission_refused', content: 'Run tests', outcome: null },
    ])
    openHaskell()

    expect(screen.getByTestId('tool-activity')).toHaveTextContent('Read notes.md')
    expect(screen.getByTestId('permission-refused')).toHaveTextContent('The agent asked to: Run tests')
    expect(screen.getByTestId('continuity-seam')).toHaveTextContent('agent switched')
  })

  it.each([
    ['incomplete', /Incomplete/],
    ['cancelled', /Cancelled/],
    ['failed', /Failed/],
    ['refused', /Refused/],
  ] as const)('marks a recorded %s turn on reopening', (outcome, label) => {
    withMessages([{ ...base, id: 'r-1', kind: 'message', content: 'Partial words', outcome }])
    openHaskell()

    const badge = screen.getByTestId('turn-outcome')
    expect(badge).toHaveAttribute('data-outcome', outcome)
    expect(badge).toHaveTextContent(label)
  })
})

describe('NodeConversation — conversation backend', () => {
  it('names the default agent when the node has not chosen one', () => {
    openHaskell()

    expect(screen.getByTestId('node-backend-name')).toHaveTextContent('default: Codex')
  })

  it("names the node's own agent", () => {
    useWorkspaceStore.getState().setNodeBackend('n-haskell', 'agent-claude')
    openHaskell()

    expect(screen.getByTestId('node-backend-name')).toHaveTextContent('Claude')
  })

  it("changes the node's agent from the header", () => {
    openHaskell()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change agent' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Run this node on' }), {
      target: { value: 'agent-claude' },
    })

    return waitFor(() => {
      expect(screen.getByTestId('node-backend-name')).toHaveTextContent('Claude')
      const node = useWorkspaceStore.getState().graph.nodes.find((n) => n.id === 'n-haskell')
      expect(node?.backendAgentId).toBe('agent-claude')
    })
  })

  it("says Learn Nodes' compaction and skill merging are unavailable, and why, pointing to the agent's own /compact", () => {
    openHaskell()

    const note = screen.getByTestId('agent-backend-limits')
    expect(note).toHaveTextContent("Learn Nodes' drill-down compaction and skill merging are unavailable on agent backends")
    expect(note).toHaveTextContent('the agent manages its own context')
    expect(note).toHaveTextContent('/compact')
    expect(screen.queryByRole('button', { name: /compact|summari|skill|merge/i })).not.toBeInTheDocument()
  })

  it('offers agent setup when none is registered', () => {
    useAgentsStore.setState({ agents: [], status: 'ready' })
    openHaskell()

    expect(screen.getByTestId('node-backend-name')).toHaveTextContent('none registered')
    fireEvent.click(screen.getByRole('button', { name: 'Set up an agent' }))
    expect(useAgentsStore.getState().panelOpen).toBe(true)
  })
})
