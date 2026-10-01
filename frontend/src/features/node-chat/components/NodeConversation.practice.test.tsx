import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { ChatMessage } from '../../../shared/lib/workspace-types'
import { revealPractice } from '../../practice'
import { useTurnStore } from '../turn-store'

import NodeConversation from './NodeConversation'

// The practice rail is its own feature with its own suite; here only what the
// conversation asks of it — through the public surface — is observed.
vi.mock('../../practice', () => ({
  revealPractice: vi.fn(),
  practiceToolLabel: (tool: string) => ({ code: 'Code', qa: 'Q&A', quiz: 'Quiz' })[tool] ?? tool,
}))

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

function fakeBackend(streams: Stream[]) {
  const queue = [...streams]
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/chat/turn' && init?.method === 'POST') {
      const next = queue.shift()
      if (!next) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(
        new Response(next.body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      )
    }
    return Promise.resolve(new Response('{"detail":"Not Found"}', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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

function openHaskell() {
  useWorkspaceStore.getState().openNode('n-haskell')
  return render(<NodeConversation />)
}

function messageBox() {
  return screen.getByRole('textbox', { name: 'Message' })
}

function type(text: string) {
  fireEvent.change(messageBox(), { target: { value: text } })
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useTurnStore.getState().reset()
  __resetIdCounter()
  vi.mocked(revealPractice).mockClear()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  useTurnStore.getState().reset()
  vi.unstubAllGlobals()
})

describe('Composer — practice commands (4c.4)', () => {
  it('offers /code, /qa and /quiz when a message starts with a slash, narrowing as you type', () => {
    fakeBackend([])
    openHaskell()

    type('/')
    const list = screen.getByRole('listbox', { name: 'Practice commands' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('/code'),
      expect.stringContaining('/qa'),
      expect.stringContaining('/quiz'),
    ])

    type('/qu')
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
  })

  it('moves through the suggestions with the arrows and completes with Tab or Enter', () => {
    fakeBackend([])
    openHaskell()

    type('/')
    fireEvent.keyDown(messageBox(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /\/qa/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(messageBox(), { key: 'Tab' })
    expect(messageBox()).toHaveValue('/qa ')
    expect(screen.queryByRole('listbox')).toBeNull()

    type('/q')
    fireEvent.keyDown(messageBox(), { key: 'ArrowUp' })
    fireEvent.keyDown(messageBox(), { key: 'Enter' })
    expect(messageBox()).toHaveValue('/quiz ')
  })

  it('dismisses the suggestions with Escape, without sending', () => {
    const fetchMock = fakeBackend([])
    openHaskell()

    type('/co')
    fireEvent.keyDown(messageBox(), { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(messageBox()).toHaveValue('/co')
    expect(turnBodies(fetchMock)).toEqual([])
  })

  it('sends a command message as typed, with the command beside it', async () => {
    const stream = controllableStream()
    const fetchMock = fakeBackend([stream])
    openHaskell()

    type('/quiz five questions on folds')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()

    expect(turnBodies(fetchMock)).toEqual([
      { threadId: 't-haskell-main', text: '/quiz five questions on folds', command: 'quiz' },
    ])
  })

  it('sends an ordinary message with no command at all', async () => {
    const fetchMock = fakeBackend([controllableStream()])
    openHaskell()

    type('/quizzes are fun')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()

    expect(turnBodies(fetchMock)).toEqual([{ threadId: 't-haskell-main', text: '/quizzes are fun' }])
  })

  it('refuses a bare command in place, keeping the draft', async () => {
    const fetchMock = fakeBackend([])
    openHaskell()

    type('/quiz ')
    fireEvent.submit(screen.getByRole('form', { name: 'Send a message' }))
    await flush()

    expect(screen.getByRole('alert')).toHaveTextContent('Say what to practise after /quiz')
    expect(messageBox()).toHaveValue('/quiz ')
    expect(turnBodies(fetchMock)).toEqual([])
  })
})

describe('NodeConversation — practice delivered during a turn (4c.3)', () => {
  it('reveals the delivery in the rail and records a line that leads back to it', async () => {
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()
    type('/quiz folds')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()

    await stream.emit('turn.started', STARTED)
    await stream.emit('practice.delivered', {
      messageId: 'm-delivery',
      tool: 'quiz',
      itemIds: ['i-1', 'i-2', 'i-3'],
      agentName: 'Codex',
    })

    expect(revealPractice).toHaveBeenCalledWith({
      nodeId: 'n-haskell',
      tool: 'quiz',
      itemIds: ['i-1', 'i-2', 'i-3'],
    })
    const line = screen.getByTestId('practice-delivered')
    expect(line).toHaveTextContent('Codex sent 3 questions to Quiz')

    vi.mocked(revealPractice).mockClear()
    fireEvent.click(within(line).getByRole('button', { name: 'Open in Quiz →' }))
    expect(revealPractice).toHaveBeenCalledWith({
      nodeId: 'n-haskell',
      tool: 'quiz',
      itemIds: ['i-1', 'i-2', 'i-3'],
    })
  })

  it('updates one line as more items of the same delivery arrive, rather than adding lines', async () => {
    // The backend reuses one messageId per tool per turn; each event carries
    // the cumulative item ids.
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()
    type('/quiz folds')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()
    await stream.emit('turn.started', STARTED)
    await stream.emit('practice.delivered', { messageId: 'm-delivery', tool: 'quiz', itemIds: ['i-1'], agentName: 'Codex' })
    await stream.emit('practice.delivered', { messageId: 'm-delivery', tool: 'quiz', itemIds: ['i-1', 'i-2'], agentName: 'Codex' })

    const lines = screen.getAllByTestId('practice-delivered')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveTextContent('Codex sent 2 questions to Quiz')
  })

  it('does not move the rail for a delivery to a session that is not on screen', async () => {
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()
    type('make me an exercise')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()
    await stream.emit('turn.started', STARTED)

    // The learner has moved to another session while the turn runs.
    act(() => useWorkspaceStore.setState({ openNodeId: 'n-somewhere-else' }))
    await stream.emit('practice.delivered', {
      messageId: 'm-delivery',
      tool: 'code',
      itemIds: ['ex-1'],
      agentName: 'Codex',
    })

    expect(revealPractice).not.toHaveBeenCalled()
  })

  it('folds the delivery into the record when the turn ends', async () => {
    const stream = controllableStream()
    fakeBackend([stream])
    openHaskell()
    type('/code fizzbuzz')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()
    await stream.emit('turn.started', STARTED)
    await stream.emit('practice.delivered', {
      messageId: 'm-delivery',
      tool: 'code',
      itemIds: ['ex-1'],
      agentName: 'Claude',
    })
    await stream.emit('turn.ended', { outcome: 'completed', reason: null })
    await stream.close()

    const recorded = useWorkspaceStore.getState().graph.messages.find((m) => m.id === 'm-delivery')
    expect(recorded).toMatchObject({
      kind: 'practice_delivered',
      content: 'Claude sent 1 exercise to Code',
      data: { tool: 'code', itemIds: ['ex-1'] },
    })
  })
})

describe('NodeConversation — recorded deliveries (after a reload)', () => {
  function withMessages(messages: ChatMessage[]) {
    const { graph } = useWorkspaceStore.getState()
    useWorkspaceStore.setState({ graph: { ...graph, messages: [...graph.messages, ...messages] } })
  }

  const base = {
    threadId: 't-haskell-main',
    createdAt: '2026-09-30T10:00:00.000Z',
    role: 'agent' as const,
    outcome: null,
  }

  it('renders a recorded delivery as a link that reveals the delivered items', () => {
    withMessages([
      {
        ...base,
        id: 'r-delivery',
        kind: 'practice_delivered',
        content: 'Codex sent 2 questions to Q&A',
        data: { tool: 'qa', itemIds: ['q-1', 'q-2'] },
      },
    ])
    openHaskell()

    const line = screen.getByTestId('practice-delivered')
    expect(line).toHaveTextContent('Codex sent 2 questions to Q&A')
    fireEvent.click(within(line).getByRole('button', { name: 'Open in Q&A →' }))
    expect(revealPractice).toHaveBeenCalledWith({ nodeId: 'n-haskell', tool: 'qa', itemIds: ['q-1', 'q-2'] })
  })

  it('renders a recorded delivery with unreadable data as text alone', () => {
    withMessages([
      { ...base, id: 'r-delivery', kind: 'practice_delivered', content: 'Codex sent practice', data: null },
    ])
    openHaskell()

    expect(screen.getByTestId('practice-delivered')).toHaveTextContent('Codex sent practice')
    expect(within(screen.getByTestId('practice-delivered')).queryByRole('button')).toBeNull()
  })

  it('renders a command that delivered nothing as a notice', () => {
    withMessages([
      {
        ...base,
        id: 'r-none',
        kind: 'practice_not_delivered',
        content: 'Nothing was delivered to Quiz.',
        data: { tool: 'quiz' },
      },
    ])
    openHaskell()

    expect(screen.getByTestId('practice-not-delivered')).toHaveTextContent('Nothing was delivered to Quiz.')
  })
})
