import { API_MODE, hostErrorFrom, httpErrorFrom, httpUrl } from './api-client'

/**
 * One server-sent event: its `event:` name and its `data:` payload, unparsed.
 *
 * The payload stays a string here because the wire format does not say what
 * it is — the caller that knows the route knows the data is JSON and which
 * shape each event name carries.
 */
export type ServerSentEvent = {
  event: string
  data: string
}

/**
 * Parses a `text/event-stream` body into events as bytes arrive.
 *
 * Written against the byte stream rather than `EventSource` because
 * `EventSource` can only GET, and a conversation turn is a POST carrying the
 * learner's message. Chunk boundaries are arbitrary — a line, a CRLF pair, or
 * a multi-byte character can be split across two reads — so text is decoded
 * in streaming mode and only complete lines are interpreted.
 */
export async function* readEventStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let name = ''
  let data: string[] = []

  const abort = () => void reader.cancel().catch(() => {})
  signal?.addEventListener('abort', abort, { once: true })

  // Returns the event a blank line completes, if the block carried data.
  function dispatch(): ServerSentEvent | null {
    const event = data.length > 0 ? { event: name || 'message', data: data.join('\n') } : null
    name = ''
    data = []
    return event
  }

  function interpret(line: string): ServerSentEvent | null {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
    // `id:` and `retry:` only matter to EventSource reconnection, which a POST
    // stream never does.
    return null
  }

  try {
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer)
        if (!match) break
        // A lone trailing CR may be the first half of a CRLF split across
        // reads; wait for the next chunk before deciding.
        if (match[0] === '\r' && match.index === buffer.length - 1) break
        const line = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const event = interpret(line)
        if (event) yield event
      }
    }
    buffer += decoder.decode()
    if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1)
    if (buffer) interpret(buffer)
    // A stream that closed without a final blank line still delivered its
    // last event; dropping it would lose the `turn.ended` that says how the
    // turn ended.
    const last = dispatch()
    if (last) yield last
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

/**
 * POSTs JSON to an API route that answers with `text/event-stream`, and yields
 * its events as they arrive.
 *
 * Aborting `signal` stops both the request and the reading, and rejects with
 * the `AbortError` — the caller decides what an abandoned stream means.
 * A non-2xx answer rejects with `ApiHttpError` before any event is yielded.
 *
 * HTTP only: the Unix-socket transport answers `invoke` calls with a whole
 * value, not a stream (see design.md Open Questions on SSE over the sidecar).
 */
export async function* postEventStream(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
  if (API_MODE === 'unix') {
    const { Channel, invoke } = await import('@tauri-apps/api/core')
    yield* invokeEventStream(path, body, signal, { Channel, invoke })
    return
  }
  const response = await fetch(httpUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw await httpErrorFrom(response, path)
  if (!response.body) return
  yield* readEventStream(response.body, signal)
}

type ChannelLike<T> = { onmessage: (message: T) => void }

export type TauriStreamBridge = {
  Channel: new () => ChannelLike<string>
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>
}

/**
 * The production transport: the sidecar is on a Unix socket only the Rust
 * host can reach, so the body arrives as text pieces over a Tauri `Channel`
 * from the `api_stream` command rather than as a `fetch` body.
 *
 * The pieces are re-encoded into a byte stream so `readEventStream` parses
 * them exactly as it parses HTTP — one parser, whatever the transport. The
 * stream closes when the command resolves (the backend closed the response)
 * and errors when it rejects, which carries the status and body of a refusal.
 */
export async function* invokeEventStream(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  { Channel, invoke }: TauriStreamBridge,
): AsyncGenerator<ServerSentEvent> {
  const encoder = new TextEncoder()
  const channel = new Channel()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      channel.onmessage = (piece) => {
        try {
          controller.enqueue(encoder.encode(piece))
        } catch {
          // Already closed by an abort; later pieces have nowhere to go.
        }
      }
      invoke('api_stream', {
        path,
        init: { method: 'POST', body: JSON.stringify(body) },
        onChunk: channel,
      }).then(
        () => {
          try {
            controller.close()
          } catch {
            // Closed already.
          }
        },
        (error: unknown) => {
          try {
            const refusal = hostErrorFrom(error, path)
            controller.error(refusal instanceof Error ? refusal : new Error(String(refusal)))
          } catch {
            // Closed already.
          }
        },
      )
    },
  })
  yield* readEventStream(stream, signal)
}
