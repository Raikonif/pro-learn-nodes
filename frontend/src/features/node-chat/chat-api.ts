import { z } from 'zod'

import apiClient from '../../shared/lib/api-client'
import { postEventStream } from '../../shared/lib/sse'
import { TurnOutcomeSchema } from '../../shared/lib/workspace-types'

/**
 * Wire contract of `POST /chat/turn` (design.md "Interfaces" → The streaming
 * turn). Each SSE event has a name and a JSON `data:` line; the name decides
 * the shape.
 */
const nullableString = z.string().nullable().optional().transform((v) => v ?? null)
const nullableNumber = z.number().nullable().optional().transform((v) => v ?? null)

const EVENT_SCHEMAS = {
  'turn.started': z.object({
    turnId: z.string().min(1),
    threadId: z.string().min(1),
    learnerMessageId: z.string().min(1),
    agentMessageId: z.string().min(1),
  }),
  text: z.object({ text: z.string() }),
  thought: z.object({ text: z.string() }),
  tool: z.object({
    messageId: z.string().min(1),
    toolCallId: z.string().min(1),
    title: z.string(),
    kind: nullableString,
    status: nullableString,
  }),
  plan: z.object({
    entries: z.array(z.object({ content: z.string(), status: z.string() })),
  }),
  'permission.refused': z.object({ messageId: z.string().min(1), title: z.string() }),
  'continuity.seam': z.object({ messageId: z.string().min(1), reason: z.string() }),
  usage: z.object({
    inputTokens: nullableNumber,
    outputTokens: nullableNumber,
    totalTokens: nullableNumber,
    model: nullableString,
  }),
  'practice.delivered': z.object({
    messageId: z.string().min(1),
    tool: z.enum(['code', 'qa', 'quiz']),
    itemIds: z.array(z.string().min(1)),
    agentName: z.string(),
  }),
  'turn.ended': z.object({
    // `incomplete` never ends a turn on the wire, but accepting the whole
    // enum keeps a backend that sends it from being silently dropped.
    outcome: TurnOutcomeSchema,
    reason: nullableString,
    detail: nullableString,
  }),
} as const

type EventSchemas = typeof EVENT_SCHEMAS
export type TurnEventName = keyof EventSchemas

/** One parsed event of a streaming turn, discriminated by `type`. */
export type TurnEvent = {
  [K in TurnEventName]: { type: K } & z.infer<EventSchemas[K]>
}[TurnEventName]

/** A composer command: asks the agent to deliver that kind of practice to its tool. */
export type TurnCommand = 'code' | 'qa' | 'quiz'

export type PracticeDelivery = Omit<Extract<TurnEvent, { type: 'practice.delivered' }>, 'type'>

export type PlanEntry = Extract<TurnEvent, { type: 'plan' }>['entries'][number]
export type TurnUsage = Omit<Extract<TurnEvent, { type: 'usage' }>, 'type'>

function isKnown(name: string): name is TurnEventName {
  return Object.prototype.hasOwnProperty.call(EVENT_SCHEMAS, name)
}

/**
 * Sends the learner's message and yields the turn's events as they arrive.
 *
 * Unknown event names and malformed payloads are skipped rather than thrown:
 * a newer backend adding an event must not break a turn in an older client.
 * Aborting `signal` rejects with the `AbortError`.
 *
 * `text` is sent as the learner typed it, command and all; `command` (when
 * the message began with `/code`, `/qa` or `/quiz`) is what tells the backend
 * to add its instruction. The key is left out entirely without one.
 */
export async function* streamTurn(
  threadId: string,
  text: string,
  signal?: AbortSignal,
  command?: TurnCommand,
): AsyncGenerator<TurnEvent> {
  const body = command ? { threadId, text, command } : { threadId, text }
  for await (const { event, data } of postEventStream('/chat/turn', body, signal)) {
    if (!isKnown(event)) continue
    let raw: unknown
    try {
      raw = JSON.parse(data)
    } catch {
      continue
    }
    const parsed = EVENT_SCHEMAS[event].safeParse(raw)
    if (!parsed.success) continue
    yield { type: event, ...parsed.data } as TurnEvent
  }
}

/** Asks the backend to stop a running turn. The stream then ends `cancelled`. */
export function cancelTurn(turnId: string): Promise<void> {
  return apiClient
    .post(`/chat/turns/${encodeURIComponent(turnId)}/cancel`, {}, { schema: z.unknown() })
    .then(() => undefined)
}
