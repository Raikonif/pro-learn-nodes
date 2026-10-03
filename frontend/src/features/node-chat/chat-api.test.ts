import { afterEach, describe, expect, it, vi } from 'vitest'

import { cancelTurn, streamTurn, type TurnEvent } from './chat-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function collect(iterable: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('streamTurn', () => {
  it('posts the thread and text and yields typed events in order', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        sseResponse(
          [
            'event: turn.started',
            'data: {"turnId":"turn-1","threadId":"t-1","learnerMessageId":"m-1","agentMessageId":"m-2"}',
            '',
            'event: text',
            'data: {"text":"Hel"}',
            '',
            'event: tool',
            'data: {"messageId":"m-3","toolCallId":"c-1","title":"Read notes.md","kind":"read","status":"pending"}',
            '',
            'event: turn.ended',
            'data: {"outcome":"completed","reason":null}',
            '',
            '',
          ].join('\n'),
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const events = await collect(streamTurn('t-1', 'Hello'))

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/chat/turn')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      threadId: 't-1',
      text: 'Hello',
    })
    expect(events).toEqual([
      {
        type: 'turn.started',
        turnId: 'turn-1',
        threadId: 't-1',
        learnerMessageId: 'm-1',
        agentMessageId: 'm-2',
      },
      { type: 'text', text: 'Hel' },
      {
        type: 'tool',
        messageId: 'm-3',
        toolCallId: 'c-1',
        title: 'Read notes.md',
        kind: 'read',
        status: 'pending',
      },
      { type: 'turn.ended', outcome: 'completed', reason: null, detail: null },
    ])
  })

  it('skips unknown events and malformed payloads instead of failing the turn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse(
            'event: something.new\ndata: {}\n\nevent: text\ndata: not json\n\nevent: text\ndata: {"nope":1}\n\nevent: text\ndata: {"text":"ok"}\n\n',
          ),
        ),
      ),
    )

    expect(await collect(streamTurn('t-1', 'x'))).toEqual([{ type: 'text', text: 'ok' }])
  })
})

describe('streamTurn — practice delivery and commands', () => {
  it('yields a practice delivery with its tool, items and agent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse(
            'event: practice.delivered\ndata: {"messageId":"m-9","tool":"quiz","itemIds":["i-1","i-2"],"agentName":"Codex"}\n\n',
          ),
        ),
      ),
    )

    expect(await collect(streamTurn('t-1', 'x'))).toEqual([
      { type: 'practice.delivered', messageId: 'm-9', tool: 'quiz', itemIds: ['i-1', 'i-2'], agentName: 'Codex' },
    ])
  })

  it('skips a delivery naming a tool it does not know', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse(
            'event: practice.delivered\ndata: {"messageId":"m-9","tool":"essay","itemIds":[],"agentName":"Codex"}\n\n',
          ),
        ),
      ),
    )

    expect(await collect(streamTurn('t-1', 'x'))).toEqual([])
  })

  it('sends a command beside the text as typed', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(sseResponse('')))
    vi.stubGlobal('fetch', fetchMock)

    await collect(streamTurn('t-1', '/quiz five questions on folds', undefined, 'quiz'))

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      threadId: 't-1',
      text: '/quiz five questions on folds',
      command: 'quiz',
    })
  })
})

describe('streamTurn — session state and context usage (agent-session-controls)', () => {
  it('yields the state the session runs with and its context usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse(
            [
              'event: session.state',
              'data: {"model":"opus","effort":"high","fast":"on","mode":"auto","modeGroup":"unasked"}',
              '',
              'event: context.usage',
              'data: {"used":17140,"size":258400}',
              '',
              '',
            ].join('\n'),
          ),
        ),
      ),
    )

    expect(await collect(streamTurn('t-1', 'x'))).toEqual([
      { type: 'session.state', model: 'opus', effort: 'high', fast: 'on', mode: 'auto', modeGroup: 'unasked' },
      { type: 'context.usage', used: 17140, size: 258400 },
    ])
  })

  it('reads an unrecognised mode group as acting without asking, and nulls what is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(sseResponse('event: session.state\ndata: {"mode":"mystery","modeGroup":"odd"}\n\n')),
      ),
    )

    expect(await collect(streamTurn('t-1', 'x'))).toEqual([
      { type: 'session.state', model: null, effort: null, fast: null, mode: 'mystery', modeGroup: 'unasked' },
    ])
  })

  it('skips a usage report without a used and total size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sseResponse('event: context.usage\ndata: {"used":12}\n\n'))),
    )

    expect(await collect(streamTurn('t-1', 'x'))).toEqual([])
  })

  it('sends an agent command as ordinary text, with no command beside it', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(sseResponse('')))
    vi.stubGlobal('fetch', fetchMock)

    await collect(streamTurn('t-1', '/compact'))

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({ threadId: 't-1', text: '/compact' })
  })
})

describe('cancelTurn', () => {
  it('posts to the turn cancel route and accepts a 204', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(cancelTurn('turn-1')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/chat/turns/turn-1/cancel')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
  })
})
