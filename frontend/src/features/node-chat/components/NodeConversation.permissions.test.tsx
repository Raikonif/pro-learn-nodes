import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { usePermissionsStore } from '../../permissions'
import { useAgentsStore } from '../../settings'
import { useTurnStore } from '../turn-store'

import NodeConversation from './NodeConversation'

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

/** The turn route answers with `stream`; a decision answers `decisionStatus`. */
function fakeBackend(stream: Stream, decisionStatus = 204) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/chat/turn' && init?.method === 'POST') {
      return Promise.resolve(new Response(stream.body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }
    if (url === '/api/permissions/pending' && (init?.method ?? 'GET') === 'GET') {
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (/^\/api\/permissions\/pending\/[^/]+$/.test(url) && init?.method === 'POST') {
      return Promise.resolve(
        decisionStatus === 204 ? new Response(null, { status: 204 }) : new Response('{}', { status: decisionStatus }),
      )
    }
    if (url === '/api/permissions/remembered') {
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return Promise.resolve(new Response('{"detail":"Not Found"}', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function decisions(fetchMock: ReturnType<typeof fakeBackend>) {
  return fetchMock.mock.calls
    .filter(([url, init]) => /\/api\/permissions\/pending\/./.test(url) && init?.method === 'POST')
    .map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) }))
}

const STARTED = {
  turnId: 'turn-1',
  threadId: 't-haskell-main',
  learnerMessageId: 'm-live-learner',
  agentMessageId: 'm-live-agent',
}

const WRITE = {
  requestId: 'req-1',
  toolCallId: 'call-1',
  title: 'Write notes.md',
  kind: 'edit',
  locations: ['/data/agent-workspaces/n-haskell/notes.md'],
  rememberable: true,
  agentRemembers: false,
}

async function startTurn(decisionStatus = 204) {
  const stream = controllableStream()
  const fetchMock = fakeBackend(stream, decisionStatus)
  useWorkspaceStore.getState().openNode('n-haskell')
  render(<NodeConversation />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'write it down' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await flush()
  await stream.emit('turn.started', STARTED)
  return { stream, fetchMock }
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useTurnStore.getState().reset()
  usePermissionsStore.getState().reset()
  useAgentsStore.getState().discard()
  useAgentsStore.setState({ agents: [], presets: [], status: 'ready' })
  __resetIdCounter()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  useTurnStore.getState().reset()
  vi.unstubAllGlobals()
})

describe('NodeConversation — the agent asks permission', () => {
  it('presents the request with what it would do and where, and nothing is recorded yet', async () => {
    const { stream } = await startTurn()
    await stream.emit('permission.requested', WRITE)

    const prompt = screen.getByTestId('permission-request')
    expect(prompt).toHaveTextContent('The agent asks to: Write notes.md')
    expect(prompt).toHaveTextContent('(edits)')
    expect(within(prompt).getByRole('list', { name: 'Affects' })).toHaveTextContent('notes.md')
    expect(within(prompt).getByRole('checkbox', { name: /Remember for this node/ })).not.toBeChecked()
    expect(within(prompt).getByRole('checkbox', { name: /edits/ })).toBeInTheDocument()
    expect(screen.queryByTestId('agent-remembers')).toBeNull()
    expect(screen.queryByTestId('permission-decision')).toBeNull()
  })

  it('offers no remembering when the request cannot be remembered, and says when the agent remembers itself', async () => {
    const { stream } = await startTurn()
    await stream.emit('permission.requested', { ...WRITE, rememberable: false, agentRemembers: true })

    const prompt = screen.getByTestId('permission-request')
    expect(within(prompt).queryByRole('checkbox')).toBeNull()
    expect(screen.getByTestId('agent-remembers')).toHaveTextContent('will remember this choice itself')
  })

  it('allowing sends the answer once, and the turn records it when the agent is told', async () => {
    const { stream, fetchMock } = await startTurn()
    await stream.emit('permission.requested', WRITE)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await flush()
    expect(decisions(fetchMock)).toEqual([{ url: '/api/permissions/pending/req-1', body: { allow: true, remember: false } }])

    await stream.emit('permission.decided', { requestId: 'req-1', messageId: 'm-decision', allow: true, remembered: false })
    expect(screen.queryByTestId('permission-request')).toBeNull()
    const decision = screen.getByTestId('permission-decision')
    expect(decision).toHaveTextContent('Allowed: Write notes.md')
    expect(decision).not.toHaveTextContent('remembered')

    await stream.emit('text', { text: 'Done.' })
    await stream.emit('turn.ended', { outcome: 'completed' })
    await stream.close()
    const record = useWorkspaceStore.getState().graph.messages.find((m) => m.id === 'm-decision')
    expect(record).toMatchObject({ kind: 'permission_decision', content: 'Write notes.md' })
    expect(record?.data).toMatchObject({ allow: true, kind: 'edit', remembered: false })
  })

  it('refusing and remembering sends both, and the record says it is remembered', async () => {
    const { stream, fetchMock } = await startTurn()
    await stream.emit('permission.requested', WRITE)

    fireEvent.click(screen.getByRole('checkbox', { name: /Remember for this node/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }))
    await flush()
    expect(decisions(fetchMock).map((d) => d.body)).toEqual([{ allow: false, remember: true }])

    await stream.emit('permission.decided', { requestId: 'req-1', messageId: 'm-decision', allow: false, remembered: true })
    const decision = screen.getByTestId('permission-decision')
    expect(decision).toHaveTextContent('Refused: Write notes.md')
    expect(decision).toHaveTextContent('remembered for this node')
  })

  it('a request already answered elsewhere leaves quietly', async () => {
    const { stream } = await startTurn(409)
    await stream.emit('permission.requested', WRITE)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await flush()

    expect(screen.queryByTestId('permission-request')).toBeNull()
    expect(screen.queryByText(/could not be sent/)).toBeNull()
  })

  it('a request is withdrawn when its turn ends unanswered', async () => {
    const { stream } = await startTurn()
    await stream.emit('permission.requested', WRITE)
    expect(screen.getByTestId('permission-request')).toBeInTheDocument()

    await stream.emit('turn.ended', { outcome: 'cancelled' })
    expect(screen.queryByTestId('permission-request')).toBeNull()
    expect(useTurnStore.getState().turns['t-haskell-main'].permissions).toEqual([])
  })

  it('stopping the turn withdraws what it was asking', async () => {
    const { stream } = await startTurn()
    await stream.emit('permission.requested', WRITE)

    act(() => useTurnStore.getState().stop('t-haskell-main'))
    expect(screen.queryByTestId('permission-request')).toBeNull()
    await flush()
  })
})

describe('NodeConversation — recorded permission decisions', () => {
  function withDecision(outcome: string | null, data: Record<string, unknown> | null) {
    const { graph } = useWorkspaceStore.getState()
    useWorkspaceStore.setState({
      graph: {
        ...graph,
        messages: [
          ...graph.messages,
          {
            id: 'm-recorded-decision',
            threadId: 't-haskell-main',
            role: 'agent',
            content: 'Run pytest',
            createdAt: '2026-10-04T10:00:00.000Z',
            kind: 'permission_decision',
            // `allowed` is outside the turn-outcome enum and reads as null.
            outcome: outcome as never,
            data,
          },
        ],
      },
    })
    useWorkspaceStore.getState().openNode('n-haskell')
    render(<NodeConversation />)
  }

  it('shows an allowed decision from its data', () => {
    withDecision(null, { allow: true, kind: 'execute', remembered: true })
    const decision = screen.getByTestId('permission-decision')
    expect(decision).toHaveTextContent('Allowed: Run pytest')
    expect(decision).toHaveTextContent('remembered for this node')
  })

  it('reads a refusal from the outcome when data does not say', () => {
    withDecision('refused', null)
    expect(screen.getByTestId('permission-decision')).toHaveTextContent('Refused: Run pytest')
  })
})
