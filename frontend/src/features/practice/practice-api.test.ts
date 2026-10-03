import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiHttpError } from '../../shared/lib/api-client'

import {
  PracticeRefusalError,
  authorItem,
  loadExerciseBuffer,
  loadNodePractice,
  saveSandbox,
  submitAttempt,
} from './practice-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(jsonResponse(body, status)),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const FREE_ITEM = {
  id: 'item-1',
  nodeId: 'node-1',
  kind: 'free_response',
  prompt: 'What is a monad?',
  options: [],
  referenceAnswer: 'A monoid in the category of endofunctors.',
  createdAt: '2026-10-01T10:00:00Z',
  starterCode: null,
  expectedOutput: null,
  authoredBy: null,
  deliveryId: null,
}

const CHOICE_ITEM = {
  id: 'item-2',
  nodeId: 'node-1',
  kind: 'multiple_choice',
  prompt: 'Pick the functor law',
  options: [
    { text: 'fmap id = id', correct: true },
    { text: 'fmap id = const', correct: false },
  ],
  referenceAnswer: null,
  createdAt: '2026-10-01T10:01:00Z',
  starterCode: null,
  expectedOutput: null,
  authoredBy: { agentId: 'agent-codex', name: 'Codex' },
  deliveryId: 'delivery-1',
}

const ATTEMPT = {
  id: 'attempt-1',
  itemId: 'item-2',
  nodeId: 'node-1',
  response: null,
  chosenOption: 0,
  correct: true,
  score: null,
  createdAt: '2026-10-01T10:02:00Z',
  runOutcome: null,
  runOutput: null,
}

const EXERCISE = {
  id: 'item-3',
  nodeId: 'node-1',
  kind: 'code_exercise',
  prompt: 'Print the sum of 1..10\nUse a loop.',
  options: [],
  referenceAnswer: null,
  createdAt: '2026-10-01T10:05:00Z',
  starterCode: 'total = 0\n',
  expectedOutput: '55',
  authoredBy: { agentId: 'agent-claude', name: 'Claude' },
  deliveryId: 'delivery-2',
}

const MATERIAL = {
  nodeId: 'node-1',
  items: [FREE_ITEM, CHOICE_ITEM],
  attempts: [ATTEMPT],
  sandbox: { code: 'print(1)', updatedAt: '2026-10-01T10:03:00Z' },
}

describe('practice api — reading a node', () => {
  it("reads a node's items, attempts and sandbox in one request", async () => {
    const fetchMock = stubFetch(MATERIAL)

    const result = await loadNodePractice('node-1')

    expect(result).toEqual({ status: 'loaded', material: MATERIAL })
    expect(fetchMock).toHaveBeenCalledWith('/api/practice/nodes/node-1', { method: 'GET' })
  })

  it('accepts a node that never had code', async () => {
    stubFetch({ ...MATERIAL, items: [], attempts: [], sandbox: { code: '', updatedAt: null } })

    const result = await loadNodePractice('node-1')

    expect(result).toMatchObject({ status: 'loaded', material: { items: [], attempts: [] } })
  })

  it('reports a failed load as failed, never as empty material', async () => {
    stubFetch({ detail: 'Not Found' }, 404)

    const result = await loadNodePractice('node-1')

    expect(result.status).toBe('failed')
    expect(result).not.toHaveProperty('material')
  })

  it('reports an unreachable backend as a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    const result = await loadNodePractice('node-1')

    expect(result).toMatchObject({ status: 'failed', reason: expect.any(String) })
  })

  it('reports a response outside the contract as a failed load', async () => {
    stubFetch({ ...MATERIAL, items: [{ ...FREE_ITEM, kind: 'essay' }] })

    const result = await loadNodePractice('node-1')

    expect(result.status).toBe('failed')
  })
})

describe('practice api — authorship and code exercises on the wire', () => {
  it('reads code exercises, authorship and run results', async () => {
    const runAttempt = {
      ...ATTEMPT,
      id: 'attempt-2',
      itemId: 'item-3',
      response: 'print(55)',
      chosenOption: null,
      correct: true,
      runOutcome: 'completed',
      runOutput: '55\n',
    }
    stubFetch({ ...MATERIAL, items: [EXERCISE], attempts: [runAttempt] })

    const result = await loadNodePractice('node-1')

    expect(result).toEqual({
      status: 'loaded',
      material: { ...MATERIAL, items: [EXERCISE], attempts: [runAttempt] },
    })
  })

  it('still reads a payload from before authorship, exercises and deliveries, as learner-written', async () => {
    const {
      starterCode: _s,
      expectedOutput: _e,
      authoredBy: _a,
      deliveryId: _d,
      ...oldItem
    } = FREE_ITEM
    const { runOutcome: _o, runOutput: _r, ...oldAttempt } = ATTEMPT
    stubFetch({ ...MATERIAL, items: [oldItem], attempts: [oldAttempt] })

    const result = await loadNodePractice('node-1')

    expect(result).toEqual({
      status: 'loaded',
      material: { ...MATERIAL, items: [FREE_ITEM], attempts: [ATTEMPT] },
    })
  })

  it('authors a code exercise', async () => {
    const fetchMock = stubFetch(EXERCISE)

    await authorItem('node-1', { kind: 'code_exercise', prompt: 'Sum', starterCode: 'x = 1' })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(init?.body as string)).toEqual({
      kind: 'code_exercise',
      prompt: 'Sum',
      starterCode: 'x = 1',
    })
  })

  it('submits a solution as its code and the run it produced', async () => {
    const fetchMock = stubFetch({
      ...ATTEMPT,
      itemId: 'item-3',
      response: 'print(55)',
      chosenOption: null,
      runOutcome: 'completed',
      runOutput: '55\n',
    })

    const attempt = await submitAttempt('item-3', {
      code: 'print(55)',
      runOutcome: 'completed',
      runOutput: '55\n',
    })

    expect(attempt.runOutcome).toBe('completed')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/practice/items/item-3/attempts')
    expect(JSON.parse(init?.body as string)).toEqual({
      code: 'print(55)',
      runOutcome: 'completed',
      runOutput: '55\n',
    })
  })

  it("reads an exercise's own buffer by item", async () => {
    const fetchMock = stubFetch({ code: 'total = 0\n', updatedAt: null })

    const buffer = await loadExerciseBuffer('node-1', 'item-3')

    expect(buffer).toEqual({ code: 'total = 0\n', updatedAt: null })
    expect(fetchMock).toHaveBeenCalledWith('/api/practice/nodes/node-1/sandbox?itemId=item-3', {
      method: 'GET',
    })
  })

  it("writes an exercise's own buffer by item", async () => {
    const fetchMock = stubFetch({ code: 'print(55)', updatedAt: '2026-10-01T10:06:00Z' })

    await saveSandbox('node-1', 'print(55)', 'item-3')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/practice/nodes/node-1/sandbox?itemId=item-3')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({ code: 'print(55)' })
  })
})

describe('practice api — authoring', () => {
  it('authors a free-response item on the node', async () => {
    const fetchMock = stubFetch(FREE_ITEM)

    const item = await authorItem('node-1', {
      kind: 'free_response',
      prompt: 'What is a monad?',
      referenceAnswer: 'A monoid in the category of endofunctors.',
    })

    expect(item).toEqual(FREE_ITEM)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/practice/nodes/node-1/items')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      kind: 'free_response',
      prompt: 'What is a monad?',
      referenceAnswer: 'A monoid in the category of endofunctors.',
    })
  })

  it('authors a multiple-choice item with each option flagged', async () => {
    const fetchMock = stubFetch(CHOICE_ITEM)

    await authorItem('node-1', {
      kind: 'multiple_choice',
      prompt: CHOICE_ITEM.prompt,
      options: CHOICE_ITEM.options,
    })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(init?.body as string)).toEqual({
      kind: 'multiple_choice',
      prompt: CHOICE_ITEM.prompt,
      options: CHOICE_ITEM.options,
    })
  })

  it("turns a 422 refusal into an error carrying the backend's reason", async () => {
    stubFetch({ detail: 'A question needs a prompt.' }, 422)

    const refusal = authorItem('node-1', { kind: 'free_response', prompt: '' })

    await expect(refusal).rejects.toBeInstanceOf(PracticeRefusalError)
    await expect(refusal).rejects.toThrow('A question needs a prompt.')
  })

  it('lets any other failure propagate unchanged', async () => {
    stubFetch({ detail: 'Not Found' }, 404)

    await expect(
      authorItem('node-1', { kind: 'free_response', prompt: 'Q' }),
    ).rejects.toBeInstanceOf(ApiHttpError)
  })
})

describe('practice api — attempts', () => {
  it('submits a chosen option and returns the stored attempt', async () => {
    const fetchMock = stubFetch(ATTEMPT)

    const attempt = await submitAttempt('item-2', { chosenOption: 0 })

    expect(attempt).toEqual(ATTEMPT)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/practice/items/item-2/attempts')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ chosenOption: 0 })
  })

  it('submits a free-response answer as text', async () => {
    const fetchMock = stubFetch({
      ...ATTEMPT,
      itemId: 'item-1',
      response: 'A burrito',
      chosenOption: null,
      correct: null,
    })

    await submitAttempt('item-1', { response: 'A burrito' })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(init?.body as string)).toEqual({ response: 'A burrito' })
  })

  it('surfaces a refused attempt with its reason', async () => {
    stubFetch({ detail: 'This question takes a chosen option.' }, 422)

    await expect(submitAttempt('item-2', { response: 'x' })).rejects.toThrow(
      'This question takes a chosen option.',
    )
  })
})

describe('practice api — sandbox', () => {
  it('replaces the sandbox buffer with code only', async () => {
    const fetchMock = stubFetch({ code: 'print(2)', updatedAt: '2026-10-01T10:04:00Z' })

    const saved = await saveSandbox('node-1', 'print(2)')

    expect(saved).toEqual({ code: 'print(2)', updatedAt: '2026-10-01T10:04:00Z' })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/practice/nodes/node-1/sandbox')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({ code: 'print(2)' })
  })
})
