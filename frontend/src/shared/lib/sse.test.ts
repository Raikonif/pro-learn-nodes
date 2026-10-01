import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiHttpError } from './api-client'
import {
  invokeEventStream,
  postEventStream,
  readEventStream,
  type ServerSentEvent,
  type TauriStreamBridge,
} from './sse'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A body that delivers exactly the given chunks, in order. */
function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      }
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = []
  for await (const event of readEventStream(stream)) events.push(event)
  return events
}

describe('readEventStream', () => {
  it('yields one event per blank-line-terminated block, with its name and data', async () => {
    const events = await collect(
      streamOf(['event: turn.started\ndata: {"turnId":"t-1"}\n\nevent: text\ndata: {"text":"Hi"}\n\n']),
    )

    expect(events).toEqual([
      { event: 'turn.started', data: '{"turnId":"t-1"}' },
      { event: 'text', data: '{"text":"Hi"}' },
    ])
  })

  it('reassembles a line split across chunk boundaries', async () => {
    const events = await collect(
      streamOf(['eve', 'nt: te', 'xt\nda', 'ta: {"text":', '"split"}\n', '\n']),
    )

    expect(events).toEqual([{ event: 'text', data: '{"text":"split"}' }])
  })

  it('handles a CRLF pair split between two chunks as one line ending', async () => {
    const events = await collect(streamOf(['event: text\r', '\ndata: {"text":"a"}\r\n\r', '\n']))

    expect(events).toEqual([{ event: 'text', data: '{"text":"a"}' }])
  })

  it('decodes a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('event: text\ndata: {"text":"é"}\n\n')
    // "é" is two bytes in UTF-8; cut between them.
    const cut = bytes.indexOf(0xc3) + 1
    const events = await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]))

    expect(events).toEqual([{ event: 'text', data: '{"text":"é"}' }])
  })

  it('joins multiple data lines with a newline and ignores comments', async () => {
    const events = await collect(streamOf([': keep-alive\n\nevent: text\ndata: one\ndata: two\n\n']))

    expect(events).toEqual([{ event: 'text', data: 'one\ntwo' }])
  })

  it('names an unnamed event "message" and skips a block with no data', async () => {
    const events = await collect(streamOf(['event: empty\n\ndata: plain\n\n']))

    expect(events).toEqual([{ event: 'message', data: 'plain' }])
  })

  it('dispatches a final event that was not followed by a blank line', async () => {
    const events = await collect(streamOf(['event: turn.ended\ndata: {"outcome":"completed"}']))

    expect(events).toEqual([{ event: 'turn.ended', data: '{"outcome":"completed"}' }])
  })
})

describe('postEventStream', () => {
  it('POSTs JSON to the proxied path and yields the parsed events', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(streamOf(['event: text\ndata: {"text":"x"}\n\n']), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const events: ServerSentEvent[] = []
    for await (const event of postEventStream('/chat/turn', { threadId: 't-1', text: 'hi' })) {
      events.push(event)
    }

    expect(events).toEqual([{ event: 'text', data: '{"text":"x"}' }])
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/chat/turn')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ threadId: 't-1', text: 'hi' }))
    expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream')
  })

  it('rejects with ApiHttpError when the stream is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: 'nope' }), { status: 404 }))),
    )

    const iterator = postEventStream('/chat/turn', {})[Symbol.asyncIterator]()
    const error = await iterator.next().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiHttpError)
    expect((error as ApiHttpError).status).toBe(404)
  })

  it('stops reading when the signal aborts mid-stream', async () => {
    const encoder = new TextEncoder()
    let pull = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pull += 1
        // One event, then a stream that never produces anything more.
        if (pull === 1) controller.enqueue(encoder.encode('event: text\ndata: first\n\n'))
        return new Promise(() => {})
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))
    const controller = new AbortController()

    const events: ServerSentEvent[] = []
    const run = (async () => {
      for await (const event of postEventStream('/chat/turn', {}, controller.signal)) {
        events.push(event)
        controller.abort()
      }
    })()

    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(events).toEqual([{ event: 'text', data: 'first' }])
  })
})

describe('invokeEventStream', () => {
  function bridge(run: (send: (piece: string) => void) => Promise<unknown>) {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = []
    class FakeChannel {
      onmessage: (message: string) => void = () => {}
    }
    const tauri: TauriStreamBridge = {
      Channel: FakeChannel,
      invoke: (command, args) => {
        calls.push({ command, args })
        const channel = args.onChunk as FakeChannel
        return run((piece) => channel.onmessage(piece))
      },
    }
    return { tauri, calls }
  }

  async function collect(stream: AsyncGenerator<ServerSentEvent>) {
    const events: ServerSentEvent[] = []
    for await (const event of stream) events.push(event)
    return events
  }

  it('parses pieces delivered over the channel, split anywhere', async () => {
    const { tauri, calls } = bridge(async (send) => {
      send('event: te')
      send('xt\ndata: {"text":"ñ')
      send('"}\n\nevent: turn.ended\ndata: {}\n\n')
    })

    const events = await collect(invokeEventStream('/chat/turn', { text: 'hi' }, undefined, tauri))

    expect(calls[0].command).toBe('api_stream')
    expect(calls[0].args).toMatchObject({
      path: '/chat/turn',
      init: { method: 'POST', body: JSON.stringify({ text: 'hi' }) },
    })
    expect(events).toEqual([
      { event: 'text', data: '{"text":"ñ"}' },
      { event: 'turn.ended', data: '{}' },
    ])
  })

  it('rejects with the refusal the host reported', async () => {
    const { tauri } = bridge(() => Promise.reject('backend returned HTTP 404: {"detail":"Thread not found"}'))

    const refusal = await collect(invokeEventStream('/chat/turn', {}, undefined, tauri)).catch(
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(ApiHttpError)
    expect(refusal).toMatchObject({ status: 404, body: { detail: 'Thread not found' } })
  })
})
