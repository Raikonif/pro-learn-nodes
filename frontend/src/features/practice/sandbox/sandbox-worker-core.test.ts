import { describe, expect, it, vi } from 'vitest'

import { MAX_FORWARDED_OUTPUT_CHARS, type WorkerResponse } from './sandbox-protocol'
import { createSandboxWorkerCore, type LoadPyodideLike } from './sandbox-worker-core'

type Emit = (stream: string, text: string) => void
type FakeRun = (code: string, emit: Emit) => unknown

function setup(fakeRun: FakeRun = () => null, options: { failLoad?: boolean } = {}) {
  const posted: WorkerResponse[] = []
  const scope: Record<string, unknown> = {
    fetch: vi.fn(),
    XMLHttpRequest: vi.fn(),
    WebSocket: vi.fn(),
    EventSource: vi.fn(),
    importScripts: vi.fn(),
  }
  const loadPyodide = vi.fn<LoadPyodideLike>(async () => {
    if (options.failLoad) throw new Error('wasm compile failed')
    return {
      runPython: vi.fn(),
      globals: { get: () => fakeRun },
    }
  })
  const importPyodide = vi.fn(async () => loadPyodide)
  const core = createSandboxWorkerCore({
    importPyodide,
    post: (message) => posted.push(message),
    scope,
  })
  return {
    core,
    posted,
    scope,
    loadPyodide,
    importPyodide,
  }
}

const INDEX_URL = 'http://127.0.0.1:5177/pyodide/'

describe('sandbox worker core', () => {
  it('loads Pyodide only from the application-served index URL', async () => {
    const { core, posted, loadPyodide, importPyodide } = setup()

    await core.handle({ type: 'prepare', indexURL: INDEX_URL })

    expect(importPyodide).toHaveBeenCalledWith(INDEX_URL)
    const config = loadPyodide.mock.calls[0][0]
    expect(config.indexURL).toBe(INDEX_URL)
    // Pyodide falls back to a public CDN for packages unless told otherwise.
    expect(config.packageBaseUrl).toBe(INDEX_URL)
    expect(posted).toEqual([{ type: 'ready' }])
  })

  it('reports an unavailable runtime when loading fails', async () => {
    const { core, posted } = setup(undefined, { failLoad: true })

    await core.handle({ type: 'prepare', indexURL: INDEX_URL })

    expect(posted).toEqual([
      { type: 'unavailable', reason: expect.stringContaining('wasm compile failed') },
    ])
  })

  it('cuts the worker off from the network once the interpreter is loaded', async () => {
    const { core, scope } = setup()
    const originalFetch = scope.fetch

    await core.handle({ type: 'prepare', indexURL: INDEX_URL })

    expect(scope.fetch).not.toBe(originalFetch)
    await expect((scope.fetch as () => Promise<unknown>)()).rejects.toThrow(/network/i)
    expect(() => new (scope.WebSocket as new () => unknown)()).toThrow(/network/i)
    expect(() => new (scope.XMLHttpRequest as new () => unknown)()).toThrow(/network/i)
  })

  it('forwards stdout and stderr in the order written and reports completion', async () => {
    const { core, posted } = setup((_code, emit) => {
      emit('stdout', 'one\n')
      emit('stderr', 'warn\n')
      emit('stdout', 'two\n')
      return null
    })
    await core.handle({ type: 'prepare', indexURL: INDEX_URL })
    posted.length = 0

    await core.handle({ type: 'run', runId: 7, code: 'x' })

    const chunks = posted.flatMap((m) => (m.type === 'output' ? m.chunks : []))
    expect(chunks).toEqual([
      { stream: 'stdout', text: 'one\n' },
      { stream: 'stderr', text: 'warn\n' },
      { stream: 'stdout', text: 'two\n' },
    ])
    expect(posted[posted.length - 1]).toEqual({ type: 'done', runId: 7, error: null })
  })

  it('streams output while the run is still going, so a terminated run keeps it', async () => {
    let mid: WorkerResponse[] = []
    const harness = setup((_code, emit) => {
      emit('stdout', 'early\n')
      emit('stdout', 'later\n')
      mid = [...harness.posted]
      return null
    })
    await harness.core.handle({ type: 'prepare', indexURL: INDEX_URL })
    harness.posted.length = 0

    await harness.core.handle({ type: 'run', runId: 1, code: 'x' })

    expect(mid.some((m) => m.type === 'output')).toBe(true)
  })

  it('passes the harness-reported error through, converting a Python dict', async () => {
    const pyDict = {
      toJs: () => ({ type: 'ZeroDivisionError', message: 'division by zero', line: 2 }),
      destroy: vi.fn(),
    }
    const { core, posted } = setup(() => pyDict)
    await core.handle({ type: 'prepare', indexURL: INDEX_URL })

    await core.handle({ type: 'run', runId: 3, code: 'x' })

    expect(posted[posted.length - 1]).toEqual({
      type: 'done',
      runId: 3,
      error: { type: 'ZeroDivisionError', message: 'division by zero', line: 2 },
    })
    expect(pyDict.destroy).toHaveBeenCalled()
  })

  it('stops forwarding past the output cap and says so once', async () => {
    const { core, posted } = setup((_code, emit) => {
      const block = 'x'.repeat(100_000)
      for (let i = 0; i < MAX_FORWARDED_OUTPUT_CHARS / 100_000 + 5; i += 1) emit('stdout', block)
      return null
    })
    await core.handle({ type: 'prepare', indexURL: INDEX_URL })

    await core.handle({ type: 'run', runId: 4, code: 'x' })

    const forwarded = posted
      .flatMap((m) => (m.type === 'output' ? m.chunks : []))
      .reduce((sum, c) => sum + c.text.length, 0)
    expect(forwarded).toBe(MAX_FORWARDED_OUTPUT_CHARS)
    expect(posted.filter((m) => m.type === 'output-truncated')).toHaveLength(1)
  })

  it('sends output the moment it is written, so a run that then never yields still shows it when stopped', async () => {
    // A `while True: pass` after a print never lets the worker's event loop
    // run again, and stopping it terminates the worker. Anything held back
    // for a later flush dies with it — the output is only safe once posted.
    let postedBeforeTheRunEnded: WorkerResponse[] = []
    const { core, posted } = setup((_code, emit) => {
      emit('stdout', 'before the loop\n')
      postedBeforeTheRunEnded = [...posted]
      return null
    })
    await core.handle({ type: 'prepare', indexURL: INDEX_URL })
    posted.length = 0

    await core.handle({ type: 'run', runId: 1, code: 'print("before the loop")\nwhile True: pass' })

    expect(postedBeforeTheRunEnded).toEqual([
      { type: 'output', runId: 1, chunks: [{ stream: 'stdout', text: 'before the loop\n' }] },
    ])
  })

})
