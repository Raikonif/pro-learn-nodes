import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PRACTICE_HIGHLIGHT_MS,
  SANDBOX_SAVE_DELAY_MS,
  bufferKey,
  usePracticeStore,
} from './practice-store'

type Route = (init?: RequestInit) => { status?: number; body: unknown } | Promise<never>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A fetch stub answering by `METHOD path`, recording every call. */
function stubBackend(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const route = routes[key]
    if (!route) throw new Error(`unexpected request: ${key}`)
    const { status = 200, body } = await route(init)
    return jsonResponse(body, status)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function material(nodeId: string, overrides: Record<string, unknown> = {}) {
  return {
    nodeId,
    items: [],
    attempts: [],
    sandbox: { code: '', updatedAt: null },
    ...overrides,
  }
}

function item(nodeId: string, id: string, prompt: string) {
  return {
    id,
    nodeId,
    kind: 'free_response',
    prompt,
    options: [],
    referenceAnswer: null,
    createdAt: '2026-10-01T10:00:00Z',
  }
}

function attempt(id: string, itemId: string, nodeId: string, response: string) {
  return {
    id,
    itemId,
    nodeId,
    response,
    chosenOption: null,
    correct: null,
    score: null,
    createdAt: '2026-10-01T10:00:00Z',
  }
}

function requests(fetchMock: ReturnType<typeof stubBackend>, method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method)
}

beforeEach(() => {
  usePracticeStore.getState().discard()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('practice store — material by node', () => {
  it("keeps each node's material under that node", async () => {
    stubBackend({
      'GET /api/practice/nodes/a': () => ({ body: material('a', { items: [item('a', 'i-a', 'A?')] }) }),
      'GET /api/practice/nodes/b': () => ({ body: material('b', { items: [item('b', 'i-b', 'B?')] }) }),
    })

    await usePracticeStore.getState().load('a')
    await usePracticeStore.getState().load('b')

    const state = usePracticeStore.getState()
    const a = state.material.a
    const b = state.material.b
    expect(a?.status === 'ready' && a.items.map((i) => i.prompt)).toEqual(['A?'])
    expect(b?.status === 'ready' && b.items.map((i) => i.prompt)).toEqual(['B?'])
  })

  it("does not show a node's material before that node has loaded", async () => {
    stubBackend({
      'GET /api/practice/nodes/a': () => ({ body: material('a', { items: [item('a', 'i-a', 'A?')] }) }),
      'GET /api/practice/nodes/b': () => new Promise<never>(() => {}),
    })
    await usePracticeStore.getState().load('a')

    void usePracticeStore.getState().load('b')

    expect(usePracticeStore.getState().material.b).toEqual({ status: 'loading' })
  })

  it('records a failed load as failed, distinct from empty material', async () => {
    stubBackend({ 'GET /api/practice/nodes/a': () => ({ status: 500, body: { detail: 'boom' } }) })

    await usePracticeStore.getState().load('a')

    expect(usePracticeStore.getState().material.a).toMatchObject({ status: 'failed' })
  })

  it('a retry after a failure restores the material', async () => {
    let fail = true
    stubBackend({
      'GET /api/practice/nodes/a': () =>
        fail ? { status: 500, body: { detail: 'boom' } } : { body: material('a') },
    })
    await usePracticeStore.getState().load('a')

    fail = false
    await usePracticeStore.getState().load('a')

    expect(usePracticeStore.getState().material.a).toMatchObject({ status: 'ready', items: [] })
  })

  it('shows a submitted attempt without refetching the node', async () => {
    const fetchMock = stubBackend({
      'GET /api/practice/nodes/a': () => ({
        body: material('a', {
          items: [item('a', 'i-1', 'Q?')],
          attempts: [attempt('t-1', 'i-1', 'a', 'first')],
        }),
      }),
      'POST /api/practice/items/i-1/attempts': () => ({ body: attempt('t-2', 'i-1', 'a', 'second') }),
    })
    await usePracticeStore.getState().load('a')

    await usePracticeStore.getState().answer('a', 'i-1', { response: 'second' })

    const a = usePracticeStore.getState().material.a
    expect(a?.status === 'ready' && a.attempts.map((t) => t.response)).toEqual(['second', 'first'])
    expect(requests(fetchMock, 'GET')).toHaveLength(1)
  })

  it('shows an authored item without refetching the node, oldest first', async () => {
    const fetchMock = stubBackend({
      'GET /api/practice/nodes/a': () => ({ body: material('a', { items: [item('a', 'i-1', 'Old?')] }) }),
      'POST /api/practice/nodes/a/items': () => ({ body: item('a', 'i-2', 'New?') }),
    })
    await usePracticeStore.getState().load('a')

    await usePracticeStore.getState().author('a', { kind: 'free_response', prompt: 'New?' })

    const a = usePracticeStore.getState().material.a
    expect(a?.status === 'ready' && a.items.map((i) => i.prompt)).toEqual(['Old?', 'New?'])
    expect(requests(fetchMock, 'GET')).toHaveLength(1)
  })

  it('a refused item changes nothing and rejects with the reason', async () => {
    stubBackend({
      'GET /api/practice/nodes/a': () => ({ body: material('a') }),
      'POST /api/practice/nodes/a/items': () => ({ status: 422, body: { detail: 'Needs a prompt.' } }),
    })
    await usePracticeStore.getState().load('a')

    await expect(
      usePracticeStore.getState().author('a', { kind: 'free_response', prompt: '' }),
    ).rejects.toThrow('Needs a prompt.')

    expect(usePracticeStore.getState().material.a).toMatchObject({ status: 'ready', items: [] })
  })
})

describe('practice store — selected tool', () => {
  it('selects the questions tool by default and remembers a selection', () => {
    expect(usePracticeStore.getState().selectedTool).toBe('questions')

    usePracticeStore.getState().selectTool('sandbox')

    expect(usePracticeStore.getState().selectedTool).toBe('sandbox')
  })

  it('selecting a tool sends nothing to the backend', () => {
    const fetchMock = stubBackend({})

    usePracticeStore.getState().selectTool('quiz')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('practice store — sandbox buffer', () => {
  it('takes the persisted code from the node read', async () => {
    stubBackend({
      'GET /api/practice/nodes/a': () => ({
        body: material('a', { sandbox: { code: 'print(1)', updatedAt: '2026-10-01T10:00:00Z' } }),
      }),
    })

    await usePracticeStore.getState().load('a')

    expect(usePracticeStore.getState().buffers.a).toBe('print(1)')
  })

  it('updates the buffer immediately and persists it once, after a pause', async () => {
    vi.useFakeTimers()
    const fetchMock = stubBackend({
      'PUT /api/practice/nodes/a/sandbox': (init) => ({
        body: { code: JSON.parse(init?.body as string).code, updatedAt: '2026-10-01T10:00:00Z' },
      }),
    })

    usePracticeStore.getState().editSandbox('a', 'p')
    usePracticeStore.getState().editSandbox('a', 'pr')
    usePracticeStore.getState().editSandbox('a', 'print(2)')

    expect(usePracticeStore.getState().buffers.a).toBe('print(2)')
    expect(requests(fetchMock, 'PUT')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(SANDBOX_SAVE_DELAY_MS)

    const puts = requests(fetchMock, 'PUT')
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0]?.[1]?.body as string)).toEqual({ code: 'print(2)' })
    expect(usePracticeStore.getState().sandboxSave.a).toBe('saved')
  })

  it('flushing writes a pending edit at once and cancels the delayed write', async () => {
    vi.useFakeTimers()
    const fetchMock = stubBackend({
      'PUT /api/practice/nodes/a/sandbox': () => ({ body: { code: 'x = 1', updatedAt: null } }),
    })
    usePracticeStore.getState().editSandbox('a', 'x = 1')

    await usePracticeStore.getState().flushSandbox('a')
    await vi.advanceTimersByTimeAsync(SANDBOX_SAVE_DELAY_MS * 2)

    expect(requests(fetchMock, 'PUT')).toHaveLength(1)
  })

  it('flushing with nothing pending sends nothing', async () => {
    const fetchMock = stubBackend({})

    await usePracticeStore.getState().flushSandbox('a')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps two nodes’ buffers independent', async () => {
    vi.useFakeTimers()
    const fetchMock = stubBackend({
      'PUT /api/practice/nodes/a/sandbox': () => ({ body: { code: 'a()', updatedAt: null } }),
      'PUT /api/practice/nodes/b/sandbox': () => ({ body: { code: 'b()', updatedAt: null } }),
    })

    usePracticeStore.getState().editSandbox('a', 'a()')
    usePracticeStore.getState().editSandbox('b', 'b()')
    await vi.advanceTimersByTimeAsync(SANDBOX_SAVE_DELAY_MS)

    expect(usePracticeStore.getState().buffers).toMatchObject({ a: 'a()', b: 'b()' })
    expect(requests(fetchMock, 'PUT').map(([url]) => url).sort()).toEqual([
      '/api/practice/nodes/a/sandbox',
      '/api/practice/nodes/b/sandbox',
    ])
  })

  it('a node read does not overwrite an edit that has not been saved yet', async () => {
    vi.useFakeTimers()
    stubBackend({
      'GET /api/practice/nodes/a': () => ({ body: material('a', { sandbox: { code: 'old', updatedAt: null } }) }),
      'PUT /api/practice/nodes/a/sandbox': () => ({ body: { code: 'new', updatedAt: null } }),
    })
    usePracticeStore.getState().editSandbox('a', 'new')

    await usePracticeStore.getState().load('a')

    expect(usePracticeStore.getState().buffers.a).toBe('new')
  })

  it('a failed save is reported and retried by the next flush', async () => {
    let fail = true
    stubBackend({
      'PUT /api/practice/nodes/a/sandbox': () =>
        fail ? { status: 500, body: { detail: 'down' } } : { body: { code: 'y', updatedAt: null } },
    })
    usePracticeStore.getState().editSandbox('a', 'y')

    await usePracticeStore.getState().flushSandbox('a')
    expect(usePracticeStore.getState().sandboxSave.a).toBe('failed')

    fail = false
    await usePracticeStore.getState().flushSandbox('a')
    expect(usePracticeStore.getState().sandboxSave.a).toBe('saved')
  })
})

function exercise(nodeId: string, id: string, prompt: string, starterCode = '') {
  return {
    ...item(nodeId, id, prompt),
    kind: 'code_exercise',
    starterCode,
    expectedOutput: null,
    authoredBy: { agentId: 'agent-codex', name: 'Codex' },
  }
}

describe('practice store — exercise buffers', () => {
  it("reads an exercise's buffer once, under its own key, beside the free buffer", async () => {
    const fetchMock = stubBackend({
      'GET /api/practice/nodes/a': () => ({
        body: material('a', { sandbox: { code: 'free()', updatedAt: null } }),
      }),
      'GET /api/practice/nodes/a/sandbox?itemId=ex-1': () => ({
        body: { code: 'starter()', updatedAt: null },
      }),
    })
    await usePracticeStore.getState().load('a')

    await usePracticeStore.getState().openExerciseBuffer('a', 'ex-1')
    await usePracticeStore.getState().openExerciseBuffer('a', 'ex-1')

    const { buffers } = usePracticeStore.getState()
    expect(buffers.a).toBe('free()')
    expect(buffers[bufferKey('a', 'ex-1')]).toBe('starter()')
    expect(requests(fetchMock, 'GET')).toHaveLength(2)
  })

  it("records a failed exercise buffer read as failed, never as an empty buffer", async () => {
    stubBackend({
      'GET /api/practice/nodes/a/sandbox?itemId=ex-1': () => ({ status: 500, body: { detail: 'x' } }),
    })

    await usePracticeStore.getState().openExerciseBuffer('a', 'ex-1')

    const state = usePracticeStore.getState()
    expect(state.buffers[bufferKey('a', 'ex-1')]).toBeUndefined()
    expect(state.bufferLoads[bufferKey('a', 'ex-1')]).toMatchObject({ status: 'failed' })
  })

  it("persists an exercise's edits to that exercise's buffer only, after a pause", async () => {
    vi.useFakeTimers()
    const fetchMock = stubBackend({
      'PUT /api/practice/nodes/a/sandbox?itemId=ex-1': () => ({ body: { code: 'sol()', updatedAt: null } }),
    })

    usePracticeStore.getState().editSandbox('a', 'sol()', 'ex-1')
    await vi.advanceTimersByTimeAsync(SANDBOX_SAVE_DELAY_MS)

    const puts = requests(fetchMock, 'PUT')
    expect(puts.map(([url]) => url)).toEqual(['/api/practice/nodes/a/sandbox?itemId=ex-1'])
    expect(usePracticeStore.getState().buffers.a).toBeUndefined()
    expect(usePracticeStore.getState().sandboxSave[bufferKey('a', 'ex-1')]).toBe('saved')
  })

  it("flushing a node writes every pending buffer of that node, and no other node's", async () => {
    const fetchMock = stubBackend({
      'PUT /api/practice/nodes/a/sandbox': () => ({ body: { code: 'f', updatedAt: null } }),
      'PUT /api/practice/nodes/a/sandbox?itemId=ex-1': () => ({ body: { code: 'e', updatedAt: null } }),
    })
    usePracticeStore.getState().editSandbox('a', 'f')
    usePracticeStore.getState().editSandbox('a', 'e', 'ex-1')
    usePracticeStore.getState().editSandbox('b', 'other')

    await usePracticeStore.getState().flushNode('a')

    expect(requests(fetchMock, 'PUT').map(([url]) => url).sort()).toEqual([
      '/api/practice/nodes/a/sandbox',
      '/api/practice/nodes/a/sandbox?itemId=ex-1',
    ])
  })

  it('submitting writes the pending buffer, then records the attempt with the run', async () => {
    const fetchMock = stubBackend({
      'GET /api/practice/nodes/a': () => ({ body: material('a', { items: [exercise('a', 'ex-1', 'Sum')] }) }),
      'PUT /api/practice/nodes/a/sandbox?itemId=ex-1': () => ({ body: { code: 'print(1)', updatedAt: null } }),
      'POST /api/practice/items/ex-1/attempts': () => ({
        body: { ...attempt('t-1', 'ex-1', 'a', 'print(1)'), runOutcome: 'completed', runOutput: '1\n' },
      }),
    })
    await usePracticeStore.getState().load('a')
    usePracticeStore.getState().editSandbox('a', 'print(1)', 'ex-1')

    await usePracticeStore
      .getState()
      .submitExercise('a', 'ex-1', { code: 'print(1)', runOutcome: 'completed', runOutput: '1\n' })

    const methods = fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')
    expect(methods).toEqual(['GET', 'PUT', 'POST'])
    const a = usePracticeStore.getState().material.a
    expect(a?.status === 'ready' && a.attempts[0]?.runOutcome).toBe('completed')
  })

  it('remembers which exercise the Code tool has open, per node', () => {
    usePracticeStore.getState().selectExercise('a', 'ex-1')

    expect(usePracticeStore.getState().selectedExercise).toEqual({ a: 'ex-1' })

    usePracticeStore.getState().selectExercise('a', null)
    expect(usePracticeStore.getState().selectedExercise.a).toBeNull()
  })
})

describe('practice store — revealing delivered practice', () => {
  it('switches to the tool, highlights the items and re-reads the node', async () => {
    const fetchMock = stubBackend({
      'GET /api/practice/nodes/a': () => ({ body: material('a') }),
    })

    usePracticeStore.getState().reveal({ nodeId: 'a', tool: 'quiz', itemIds: ['q-1', 'q-2'] })

    const state = usePracticeStore.getState()
    expect(state.selectedTool).toBe('quiz')
    expect(state.highlight).toMatchObject({ nodeId: 'a', itemIds: ['q-1', 'q-2'] })
    await vi.waitFor(() => expect(requests(fetchMock, 'GET')).toHaveLength(1))
  })

  it('maps each delivered tool to its tab', () => {
    stubBackend({ 'GET /api/practice/nodes/a': () => ({ body: material('a') }) })

    usePracticeStore.getState().reveal({ nodeId: 'a', tool: 'qa', itemIds: [] })
    expect(usePracticeStore.getState().selectedTool).toBe('questions')

    usePracticeStore.getState().reveal({ nodeId: 'a', tool: 'code', itemIds: [] })
    expect(usePracticeStore.getState().selectedTool).toBe('sandbox')
  })

  it('opens a delivered code exercise in the Code tool', () => {
    stubBackend({ 'GET /api/practice/nodes/a': () => ({ body: material('a') }) })

    usePracticeStore.getState().reveal({ nodeId: 'a', tool: 'code', itemIds: ['ex-9'] })

    expect(usePracticeStore.getState().selectedExercise.a).toBe('ex-9')
  })

  it('lets the highlight fade after a few seconds', async () => {
    vi.useFakeTimers()
    stubBackend({ 'GET /api/practice/nodes/a': () => ({ body: material('a') }) })

    usePracticeStore.getState().reveal({ nodeId: 'a', tool: 'qa', itemIds: ['q-1'] })
    await vi.advanceTimersByTimeAsync(PRACTICE_HIGHLIGHT_MS)

    expect(usePracticeStore.getState().highlight).toBeNull()
  })

  it('discarding forgets highlights, open exercises and exercise buffers', () => {
    stubBackend({ 'GET /api/practice/nodes/a': () => ({ body: material('a') }) })
    usePracticeStore.getState().reveal({ nodeId: 'a', tool: 'code', itemIds: ['ex-1'] })
    usePracticeStore.getState().editSandbox('a', 'x', 'ex-1')

    usePracticeStore.getState().discard()

    const state = usePracticeStore.getState()
    expect(state.highlight).toBeNull()
    expect(state.selectedExercise).toEqual({})
    expect(state.buffers).toEqual({})
  })
})
