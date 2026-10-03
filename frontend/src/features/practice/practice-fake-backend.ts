/**
 * An in-memory stand-in for the practice routes, for the feature's component
 * tests. It speaks the wire shapes from design.md "The wire shapes" and keeps
 * attempts append-only, so a test exercising the rail talks to something that
 * behaves like the backend rather than to hand-written canned replies.
 *
 * Test-only: nothing in the app imports it.
 */
import type { PracticeAttempt, PracticeItem } from './practice-api'

type NodeRecord = {
  items: PracticeItem[]
  /** Newest first, as the route returns them. */
  attempts: PracticeAttempt[]
  code: string
  updatedAt: string | null
  /** Exercise buffers by item id; absent until first written. */
  exerciseCode: Map<string, string>
}

export type RecordedRequest = { method: string; url: string; body: unknown }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createFakePracticeBackend() {
  const nodes = new Map<string, NodeRecord>()
  const requests: RecordedRequest[] = []
  let failingReads = false
  let nextRefusal: string | null = null
  let sequence = 0

  function node(nodeId: string): NodeRecord {
    let record = nodes.get(nodeId)
    if (!record) {
      record = { items: [], attempts: [], code: '', updatedAt: null, exerciseCode: new Map() }
      nodes.set(nodeId, record)
    }
    return record
  }

  function stamp(): string {
    sequence += 1
    return new Date(Date.UTC(2026, 9, 1, 10, 0, sequence)).toISOString()
  }

  function findItem(itemId: string): PracticeItem | undefined {
    for (const record of nodes.values()) {
      const item = record.items.find((candidate) => candidate.id === itemId)
      if (item) return item
    }
    return undefined
  }

  async function fetch(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ method, url, body })

    let match = /^\/api\/practice\/nodes\/([^/]+)$/.exec(url)
    if (match && method === 'GET') {
      if (failingReads) return json({ detail: 'Practice storage is unavailable.' }, 503)
      const nodeId = decodeURIComponent(match[1])
      const record = node(nodeId)
      return json({
        nodeId,
        items: record.items,
        attempts: record.attempts,
        sandbox: { code: record.code, updatedAt: record.updatedAt },
      })
    }

    match = /^\/api\/practice\/nodes\/([^/]+)\/items$/.exec(url)
    if (match && method === 'POST') {
      if (nextRefusal !== null) {
        const detail = nextRefusal
        nextRefusal = null
        return json({ detail }, 422)
      }
      const nodeId = decodeURIComponent(match[1])
      const item: PracticeItem = {
        id: `item-${++sequence}`,
        nodeId,
        kind: body.kind,
        prompt: body.prompt,
        options: body.options ?? [],
        referenceAnswer: body.referenceAnswer ?? null,
        createdAt: stamp(),
        starterCode: body.starterCode ?? null,
        expectedOutput: body.expectedOutput ?? null,
        authoredBy: null,
        deliveryId: null,
      }
      node(nodeId).items.push(item)
      return json(item)
    }

    match = /^\/api\/practice\/items\/([^/]+)\/attempts$/.exec(url)
    if (match && method === 'POST') {
      const item = findItem(decodeURIComponent(match[1]))
      if (!item) return json({ detail: 'Not Found' }, 404)
      const chosenOption: number | null = body.chosenOption ?? null
      const isCode = item.kind === 'code_exercise'
      let correct: boolean | null = chosenOption === null ? null : (item.options[chosenOption]?.correct ?? false)
      if (isCode) {
        correct =
          item.expectedOutput === null
            ? null
            : body.runOutcome === 'completed' &&
              String(body.runOutput ?? '').trimEnd() === item.expectedOutput.trimEnd()
      }
      const attempt: PracticeAttempt = {
        id: `attempt-${++sequence}`,
        itemId: item.id,
        nodeId: item.nodeId,
        response: isCode ? body.code : (body.response ?? null),
        chosenOption,
        correct,
        score: null,
        createdAt: stamp(),
        runOutcome: isCode ? body.runOutcome : null,
        runOutput: isCode ? body.runOutput : null,
      }
      node(item.nodeId).attempts.unshift(attempt)
      return json(attempt)
    }

    match = /^\/api\/practice\/nodes\/([^/?]+)\/sandbox(?:\?itemId=(.+))?$/.exec(url)
    if (match) {
      const record = node(decodeURIComponent(match[1]))
      const itemId = match[2] === undefined ? undefined : decodeURIComponent(match[2])
      if (itemId === undefined && method === 'PUT') {
        record.code = body.code
        record.updatedAt = stamp()
        return json({ code: record.code, updatedAt: record.updatedAt })
      }
      if (itemId !== undefined) {
        const exercise = record.items.find((candidate) => candidate.id === itemId)
        if (!exercise) return json({ detail: 'Not Found' }, 404)
        if (method === 'PUT') {
          record.exerciseCode.set(itemId, body.code)
          return json({ code: body.code, updatedAt: stamp() })
        }
        if (method === 'GET') {
          const saved = record.exerciseCode.get(itemId)
          return json(
            saved === undefined
              ? { code: exercise.starterCode ?? '', updatedAt: null }
              : { code: saved, updatedAt: '2026-10-01T10:00:00.000Z' },
          )
        }
      }
    }

    // Anything else (e.g. the chrome's health probe) never answers.
    return new Promise<Response>(() => {})
  }

  /**
   * Adds an item as another producer would — an agent through the context
   * server — without going through the routes. Returns the stored item.
   */
  function addItem(nodeId: string, fields: Partial<PracticeItem> & Pick<PracticeItem, 'kind' | 'prompt'>): PracticeItem {
    const item: PracticeItem = {
      id: `item-${++sequence}`,
      nodeId,
      options: [],
      referenceAnswer: null,
      createdAt: stamp(),
      starterCode: null,
      expectedOutput: null,
      authoredBy: null,
      deliveryId: null,
      ...fields,
    }
    node(nodeId).items.push(item)
    return item
  }

  return {
    fetch,
    nodes,
    addItem,
    requests,
    node,
    /** Makes every node read fail until turned off — the "cannot load" state. */
    failReads(fail: boolean) {
      failingReads = fail
    },
    /** Refuses the next item creation with this reason, as the backend's 422 does. */
    refuseNextItem(detail: string) {
      nextRefusal = detail
    },
    requestsTo(method: string, pattern: RegExp): RecordedRequest[] {
      return requests.filter((request) => request.method === method && pattern.test(request.url))
    },
  }
}

export type FakePracticeBackend = ReturnType<typeof createFakePracticeBackend>
