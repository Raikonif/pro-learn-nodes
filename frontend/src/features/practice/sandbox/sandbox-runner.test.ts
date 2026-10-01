import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeWorkerFactory } from './fake-sandbox-worker'
import {
  SANDBOX_TIME_LIMIT_MS,
  SandboxBusyError,
  SandboxUnavailableError,
  createSandboxRunner,
} from './sandbox-runner'

const INDEX_URL = 'http://127.0.0.1:5177/pyodide/'

function setup(options: { timeoutMs?: number; prepareTimeoutMs?: number } = {}) {
  const factory = createFakeWorkerFactory()
  const runner = createSandboxRunner({
    createWorker: factory.createWorker,
    indexURL: INDEX_URL,
    ...options,
  })
  return { factory, runner }
}

/** Resolve microtasks so awaited promises inside the runner make progress. */
async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

async function readyRunner(options?: Parameters<typeof setup>[0]) {
  const harness = setup(options)
  const prepared = harness.runner.prepare()
  harness.factory.current.ready()
  await prepared
  return harness
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sandbox runner — preparation', () => {
  it('creates nothing until asked to prepare or run', () => {
    const { factory, runner } = setup()

    expect(factory.workers).toHaveLength(0)
    expect(runner.getState()).toEqual({ status: 'idle', unavailableReason: null })
  })

  it('reports preparing, then ready, and loads from the given index URL', async () => {
    const { factory, runner } = setup()

    const prepared = runner.prepare()
    expect(runner.getState().status).toBe('preparing')
    expect(factory.current.received).toEqual([{ type: 'prepare', indexURL: INDEX_URL }])

    factory.current.ready()
    await prepared
    expect(runner.getState().status).toBe('ready')
  })

  it('reports an unavailable runtime, distinct from preparing, with the reason', async () => {
    const { factory, runner } = setup()

    const prepared = runner.prepare()
    factory.current.unavailable('WebAssembly is disabled')

    await expect(prepared).rejects.toBeInstanceOf(SandboxUnavailableError)
    expect(runner.getState()).toEqual({
      status: 'unavailable',
      unavailableReason: expect.stringContaining('WebAssembly is disabled'),
    })
  })

  it('treats a worker that fails to start as unavailable', async () => {
    const { factory, runner } = setup()

    const prepared = runner.prepare()
    factory.current.crash('Failed to fetch worker script')

    await expect(prepared).rejects.toBeInstanceOf(SandboxUnavailableError)
    expect(runner.getState().status).toBe('unavailable')
    expect(factory.current.terminated).toBe(true)
  })

  it('treats a preparation that never finishes as unavailable', async () => {
    vi.useFakeTimers()
    const { runner } = setup({ prepareTimeoutMs: 1000 })

    const prepared = runner.prepare()
    const assertion = expect(prepared).rejects.toBeInstanceOf(SandboxUnavailableError)
    await vi.advanceTimersByTimeAsync(1000)

    await assertion
    expect(runner.getState().status).toBe('unavailable')
  })

  it('retries from unavailable with a new worker', async () => {
    const { factory, runner } = setup()
    const first = runner.prepare()
    factory.current.unavailable('boom')
    await first.catch(() => undefined)

    const retry = runner.prepare()
    expect(factory.workers).toHaveLength(2)
    factory.current.ready()
    await retry

    expect(runner.getState()).toEqual({ status: 'ready', unavailableReason: null })
  })

  it('notifies subscribers on every state change', async () => {
    const { factory, runner } = setup()
    const seen: string[] = []
    runner.subscribe(() => seen.push(runner.getState().status))

    const prepared = runner.prepare()
    factory.current.ready()
    await prepared

    expect(seen).toEqual(['preparing', 'ready'])
  })
})

describe('sandbox runner — runs', () => {
  it('reports stdout and stderr in the order produced (8.1)', async () => {
    const { factory, runner } = await readyRunner()
    const live: string[] = []

    const result = runner.run('print("a")', { onOutput: (chunk) => live.push(chunk.text) })
    const worker = factory.current
    expect(runner.getState().status).toBe('running')
    worker.output({ stream: 'stdout', text: 'a\n' })
    worker.output({ stream: 'stderr', text: 'oops\n' }, { stream: 'stdout', text: 'b\n' })
    worker.done()

    expect(await result).toEqual({
      output: [
        { stream: 'stdout', text: 'a\n' },
        { stream: 'stderr', text: 'oops\n' },
        { stream: 'stdout', text: 'b\n' },
      ],
      outcome: { kind: 'completed' },
      outputTruncated: false,
    })
    expect(live).toEqual(['a\n', 'oops\n', 'b\n'])
  })

  it('reports a run with no output as completed, not failed (8.1)', async () => {
    const { factory, runner } = await readyRunner()

    const result = runner.run('x = 1')
    factory.current.done()

    expect(await result).toEqual({
      output: [],
      outcome: { kind: 'completed' },
      outputTruncated: false,
    })
  })

  it('reports an uncaught error with type, message and line, keeping prior output (8.2)', async () => {
    const { factory, runner } = await readyRunner()

    const result = runner.run('print(1)\n1/0')
    factory.current.output({ stream: 'stdout', text: '1\n' })
    factory.current.done({ type: 'ZeroDivisionError', message: 'division by zero', line: 2 })

    expect(await result).toEqual({
      output: [{ stream: 'stdout', text: '1\n' }],
      outcome: { kind: 'error', type: 'ZeroDivisionError', message: 'division by zero', line: 2 },
      outputTruncated: false,
    })
  })

  it('reports unparseable code the same way, with no output (8.2)', async () => {
    const { factory, runner } = await readyRunner()

    const result = runner.run('if True print(1)')
    factory.current.done({ type: 'SyntaxError', message: 'invalid syntax', line: 1 })

    expect(await result).toEqual({
      output: [],
      outcome: { kind: 'error', type: 'SyntaxError', message: 'invalid syntax', line: 1 },
      outputTruncated: false,
    })
  })

  it('records that output was truncated by the worker', async () => {
    const { factory, runner } = await readyRunner()

    const result = runner.run('while True: print(1)')
    factory.current.output({ stream: 'stdout', text: '1\n' })
    factory.current.respond({ type: 'output-truncated', runId: factory.current.lastRunId })
    factory.current.done()

    expect((await result).outputTruncated).toBe(true)
  })

  it('refuses a run while another is in progress, without queueing or interleaving (8.3)', async () => {
    const { factory, runner } = await readyRunner()
    const worker = factory.current

    const first = runner.run('while True: pass')
    await expect(runner.run('print(2)')).rejects.toBeInstanceOf(SandboxBusyError)
    expect(runner.isRunInProgress()).toBe(true)

    worker.output({ stream: 'stdout', text: 'first\n' })
    worker.done()
    const result = await first

    // Exactly one run reached any worker, and nothing was started afterwards.
    expect(factory.workers.flatMap((w) => w.runs)).toHaveLength(1)
    expect(result.output).toEqual([{ stream: 'stdout', text: 'first\n' }])
    factory.current.ready()
    await flush()
    expect(factory.workers.flatMap((w) => w.runs)).toHaveLength(1)
  })

  it('refuses a second run even while the first is still waiting for the runtime', async () => {
    const { factory, runner } = setup()

    const first = runner.run('print(1)')
    await expect(runner.run('print(2)')).rejects.toBeInstanceOf(SandboxBusyError)

    factory.current.ready()
    await flush()
    factory.current.done()
    await first
    expect(factory.workers.flatMap((w) => w.runs)).toHaveLength(1)
  })

  it('prepares on demand when run before prepare', async () => {
    const { factory, runner } = setup()

    const result = runner.run('print(1)')
    expect(runner.getState().status).toBe('preparing')
    factory.current.ready()
    await flush()
    expect(factory.current.runs).toHaveLength(1)
    factory.current.done()

    expect((await result).outcome).toEqual({ kind: 'completed' })
  })

  it('rejects a run when the runtime cannot be prepared', async () => {
    const { factory, runner } = setup()

    const result = runner.run('print(1)')
    factory.current.unavailable('no wasm')

    await expect(result).rejects.toBeInstanceOf(SandboxUnavailableError)
    expect(runner.isRunInProgress()).toBe(false)
  })
})

describe('sandbox runner — stop and timeout', () => {
  it('stops a non-terminating run by terminating its worker, keeping prior output (8.4)', async () => {
    const { factory, runner } = await readyRunner()
    const worker = factory.current

    const result = runner.run('while True: print("tick")')
    worker.output({ stream: 'stdout', text: 'tick\ntick\n' })
    runner.stop()

    expect(await result).toEqual({
      output: [{ stream: 'stdout', text: 'tick\ntick\n' }],
      outcome: { kind: 'stopped' },
      outputTruncated: false,
    })
    expect(worker.terminated).toBe(true)
    expect(runner.isRunInProgress()).toBe(false)
  })

  it('accepts a new run immediately after a stop, on a fresh worker (8.4)', async () => {
    const { factory, runner } = await readyRunner()
    const stoppedWorker = factory.current
    const stopped = runner.run('while True: pass')
    runner.stop()
    await stopped

    // A replacement is already warming up; the next run does not wait for a
    // request to start it.
    expect(factory.workers).toHaveLength(2)
    const next = runner.run('print("again")')
    factory.current.ready()
    await flush()
    factory.current.output({ stream: 'stdout', text: 'again\n' })
    factory.current.done()

    expect(await next).toMatchObject({
      output: [{ stream: 'stdout', text: 'again\n' }],
      outcome: { kind: 'completed' },
    })
    expect(stoppedWorker.runs).toHaveLength(1)
  })

  it('ignores anything a stopped worker says afterwards', async () => {
    const { factory, runner } = await readyRunner()
    const worker = factory.current
    const stopped = runner.run('while True: pass')
    runner.stop()
    await stopped

    worker.terminated = false // simulate a message already in flight
    worker.output({ stream: 'stdout', text: 'late\n' })
    worker.done()

    expect(runner.isRunInProgress()).toBe(false)
  })

  it('stopping while the runtime is still preparing ends the pending run', async () => {
    const { factory, runner } = setup()

    const result = runner.run('print(1)')
    runner.stop()

    expect(await result).toMatchObject({ outcome: { kind: 'stopped' }, output: [] })
    factory.current.ready()
    await flush()
    expect(factory.workers.flatMap((w) => w.runs)).toHaveLength(0)
  })

  it('stop with no run in progress does nothing', async () => {
    const { factory, runner } = await readyRunner()

    runner.stop()

    expect(factory.workers).toHaveLength(1)
    expect(factory.current.terminated).toBe(false)
  })

  it('uses a 10 second limit by default', () => {
    expect(SANDBOX_TIME_LIMIT_MS).toBe(10_000)
    expect(setup().runner.timeoutMs).toBe(10_000)
  })

  it('terminates a run that exceeds the limit and names the limit (8.5)', async () => {
    vi.useFakeTimers()
    const { factory, runner } = await readyRunner()
    const worker = factory.current

    const result = runner.run('while True: pass')
    worker.output({ stream: 'stdout', text: 'started\n' })
    await vi.advanceTimersByTimeAsync(SANDBOX_TIME_LIMIT_MS - 1)
    expect(runner.isRunInProgress()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)

    expect(await result).toEqual({
      output: [{ stream: 'stdout', text: 'started\n' }],
      outcome: { kind: 'timed_out', limitMs: SANDBOX_TIME_LIMIT_MS },
      outputTruncated: false,
    })
    expect(worker.terminated).toBe(true)
  })

  it('runs normally after a timeout (8.5)', async () => {
    vi.useFakeTimers()
    const { factory, runner } = await readyRunner({ timeoutMs: 500 })

    const timedOut = runner.run('while True: pass')
    await vi.advanceTimersByTimeAsync(500)
    expect((await timedOut).outcome).toEqual({ kind: 'timed_out', limitMs: 500 })

    const next = runner.run('print(1)')
    factory.current.ready()
    await vi.advanceTimersByTimeAsync(0)
    factory.current.done()
    expect((await next).outcome).toEqual({ kind: 'completed' })
  })

  it('does not count preparation time against the run limit', async () => {
    vi.useFakeTimers()
    const { factory, runner } = setup({ timeoutMs: 500 })

    const result = runner.run('print(1)')
    await vi.advanceTimersByTimeAsync(2000)
    factory.current.ready()
    await vi.advanceTimersByTimeAsync(0)
    factory.current.done()

    expect((await result).outcome).toEqual({ kind: 'completed' })
  })

  it('reports a worker that dies mid-run as an error and recovers', async () => {
    const { factory, runner } = await readyRunner()
    const worker = factory.current

    const result = runner.run('x = [0] * 10**12')
    worker.output({ stream: 'stdout', text: 'partial\n' })
    worker.crash('out of memory')

    expect(await result).toMatchObject({
      output: [{ stream: 'stdout', text: 'partial\n' }],
      outcome: { kind: 'error', type: 'SandboxCrashed', line: null },
    })
    expect(worker.terminated).toBe(true)
    expect(factory.workers).toHaveLength(2)
  })
})

describe('sandbox runner — every run starts from a clean interpreter (8.6)', () => {
  it('never sends a second run to a worker that has already run code', async () => {
    const { factory, runner } = await readyRunner()

    for (const code of ['secret = 42', 'import json; json.x = 1', 'print(secret)']) {
      const result = runner.run(code)
      const received = factory.current.received
      if (received[received.length - 1]?.type !== 'run') {
        factory.current.ready()
        await flush()
      }
      factory.current.done()
      await result
    }

    expect(factory.workers.map((w) => w.runs.length)).toEqual([1, 1, 1, 0])
    // Every worker that ran code is gone, so nothing it set up survives.
    expect(factory.workers.slice(0, 3).every((w) => w.terminated)).toBe(true)
  })

  it('does not reuse the interpreter of a stopped run', async () => {
    const { factory, runner } = await readyRunner()
    const stoppedRun = runner.run('x = 1\nwhile True: pass')
    const stoppedWorker = factory.current
    runner.stop()
    await stoppedRun

    const next = runner.run('print(x)')
    factory.current.ready()
    await flush()

    expect(factory.current).not.toBe(stoppedWorker)
    expect(factory.current.runs).toHaveLength(1)
    factory.current.done()
    await next
  })

  it('warms the replacement interpreter in the background after a normal run', async () => {
    const { factory, runner } = await readyRunner()

    const result = runner.run('print(1)')
    factory.current.done()
    await result

    expect(factory.workers).toHaveLength(2)
    expect(factory.current.received).toEqual([{ type: 'prepare', indexURL: INDEX_URL }])
    expect(runner.getState().status).toBe('preparing')
  })
})

describe('sandbox runner — dispose', () => {
  it('terminates its worker and ends any run as stopped', async () => {
    const { factory, runner } = await readyRunner()
    const worker = factory.current
    const result = runner.run('while True: pass')

    runner.dispose()

    expect((await result).outcome).toEqual({ kind: 'stopped' })
    expect(worker.terminated).toBe(true)
    expect(factory.workers).toHaveLength(1)
    expect(runner.getState().status).toBe('idle')
  })
})
