/**
 * The main-thread side of the code sandbox.
 *
 * Python runs in a dedicated worker, so a run never blocks the UI thread. The
 * rules this module owns:
 *
 * - **One interpreter per run.** A worker serves exactly one run and is
 *   terminated afterwards, whatever the outcome; a replacement starts warming
 *   immediately so the next run rarely waits. No run can observe names,
 *   imports, mutated modules, files or any other state from an earlier one.
 * - **Stop and timeout terminate the worker.** Nothing cooperative is asked of
 *   the program, so a tight loop (even inside native code) always ends.
 * - **One run at a time.** A run requested while another is pending or in
 *   progress is refused with `SandboxBusyError` — never queued.
 * - **Nothing loads until asked.** No worker (and so no Pyodide asset) is
 *   created until `prepare()` or the first `run()`.
 */
import { resolvePyodideIndexURL } from './pyodide-assets'
import {
  appendChunk,
  type HarnessError,
  type OutputChunk,
  type RunOutcome,
  type RunResult,
  type SandboxWorkerLike,
  type WorkerResponse,
} from './sandbox-protocol'

/** The fixed maximum duration of a run. Preparation time is not counted. */
export const SANDBOX_TIME_LIMIT_MS = 10_000

/** How long loading the runtime may take before it is declared unavailable. */
export const SANDBOX_PREPARE_TIMEOUT_MS = 60_000

export type SandboxStatus = 'idle' | 'preparing' | 'ready' | 'running' | 'unavailable'

export type SandboxRunnerState = {
  status: SandboxStatus
  /** Why the runtime is unavailable; `null` in every other status. */
  unavailableReason: string | null
}

export type RunOptions = {
  /** Called with each chunk as it arrives, before the run has ended. */
  onOutput?: (chunk: OutputChunk) => void
}

export interface SandboxRunner {
  readonly timeoutMs: number
  getState(): SandboxRunnerState
  subscribe(listener: () => void): () => void
  /** Load the runtime. Rejects with `SandboxUnavailableError` if it cannot. */
  prepare(): Promise<void>
  /**
   * Run `code` as a whole program in a fresh interpreter. Rejects with
   * `SandboxBusyError` if a run is already pending or in progress, and with
   * `SandboxUnavailableError` if the runtime cannot be prepared.
   */
  run(code: string, options?: RunOptions): Promise<RunResult>
  isRunInProgress(): boolean
  /** End the current run (reported as `stopped`). No-op when idle. */
  stop(): void
  /** Terminate everything; the runner may be prepared again afterwards. */
  dispose(): void
}

export type CreateSandboxRunnerOptions = {
  timeoutMs?: number
  prepareTimeoutMs?: number
  /** Injectable for tests; the default starts the real Pyodide worker. */
  createWorker?: () => SandboxWorkerLike
  /** Defaults to the app-served runtime directory (`/pyodide/`). */
  indexURL?: string
}

export class SandboxBusyError extends Error {
  constructor() {
    super('A run is already in progress.')
    this.name = 'SandboxBusyError'
  }
}

export class SandboxUnavailableError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'SandboxUnavailableError'
  }
}

function createPyodideWorker(): SandboxWorkerLike {
  // Vite bundles the worker as its own chunk; nothing here pulls Pyodide into
  // the main bundle, and the worker itself only fetches the runtime once it
  // receives `prepare`.
  return new Worker(new URL('./sandbox.worker.ts', import.meta.url), {
    type: 'module',
    name: 'learn-nodes-python-sandbox',
  }) as unknown as SandboxWorkerLike
}

type Slot = {
  worker: SandboxWorkerLike
  ready: Promise<void>
  isReady: boolean
  hasRun: boolean
  prepareTimer: ReturnType<typeof setTimeout> | null
}

type ActiveRun = {
  id: number
  output: OutputChunk[]
  outputTruncated: boolean
  onOutput?: (chunk: OutputChunk) => void
  resolve: (result: RunResult) => void
  slot: Slot | null
  timer: ReturnType<typeof setTimeout> | null
}

export function createSandboxRunner(options: CreateSandboxRunnerOptions = {}): SandboxRunner {
  const timeoutMs = options.timeoutMs ?? SANDBOX_TIME_LIMIT_MS
  const prepareTimeoutMs = options.prepareTimeoutMs ?? SANDBOX_PREPARE_TIMEOUT_MS
  const createWorker = options.createWorker ?? createPyodideWorker

  let state: SandboxRunnerState = { status: 'idle', unavailableReason: null }
  const listeners = new Set<() => void>()
  let slot: Slot | null = null
  let active: ActiveRun | null = null
  let nextRunId = 1

  function setState(status: SandboxStatus, unavailableReason: string | null = null) {
    if (state.status === status && state.unavailableReason === unavailableReason) return
    state = { status, unavailableReason }
    for (const listener of [...listeners]) listener()
  }

  function discard(target: Slot) {
    if (target.prepareTimer) clearTimeout(target.prepareTimer)
    target.worker.onmessage = null
    target.worker.onerror = null
    target.worker.terminate()
    if (slot === target) slot = null
  }

  function spawn(): Slot {
    if (slot) discard(slot)
    const worker = createWorker()
    let settle!: { resolve: () => void; reject: (error: Error) => void }
    const ready = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject }
    })
    // Background spawns (after a run) have no caller awaiting them; the
    // failure is reflected in state, not thrown into the void.
    ready.catch(() => undefined)
    const own: Slot = { worker, ready, isReady: false, hasRun: false, prepareTimer: null }
    slot = own
    own.prepareTimer = setTimeout(() => {
      fail(`it did not finish loading within ${Math.round(prepareTimeoutMs / 1000)} s.`)
    }, prepareTimeoutMs)

    function fail(reason: string) {
      if (slot !== own) return
      discard(own)
      const message = `Python could not be loaded: ${reason}`
      setState('unavailable', message)
      settle.reject(new SandboxUnavailableError(message))
    }

    worker.onmessage = (event) => {
      if (slot !== own) return
      const message = event.data
      if (message.type === 'ready') {
        if (own.prepareTimer) clearTimeout(own.prepareTimer)
        own.prepareTimer = null
        own.isReady = true
        if (!active || active.slot !== own) setState('ready')
        settle.resolve()
      } else if (message.type === 'unavailable') {
        fail(message.reason)
      } else {
        handleRunMessage(own, message)
      }
    }

    worker.onerror = (event) => {
      if (slot !== own) return
      const reason = event.message || 'the Python worker could not start.'
      if (!own.isReady) {
        fail(reason)
        return
      }
      if (active && active.slot === own) {
        finish(active, {
          kind: 'error',
          type: 'SandboxCrashed',
          message: `The Python runtime stopped unexpectedly: ${reason}`,
          line: null,
        })
      } else {
        // An idle, warmed interpreter died; start another quietly.
        discard(own)
        spawn()
      }
    }

    setState('preparing')
    worker.postMessage({ type: 'prepare', indexURL: options.indexURL ?? resolvePyodideIndexURL() })
    return own
  }

  function handleRunMessage(own: Slot, message: WorkerResponse) {
    if (!active || active.slot !== own) return
    if (message.type === 'output' && message.runId === active.id) {
      for (const chunk of message.chunks) {
        appendChunk(active.output, chunk)
        active.onOutput?.(chunk)
      }
    } else if (message.type === 'output-truncated' && message.runId === active.id) {
      active.outputTruncated = true
    } else if (message.type === 'done' && message.runId === active.id) {
      finish(active, outcomeFrom(message.error))
    }
  }

  function outcomeFrom(error: HarnessError | null): RunOutcome {
    return error ? { kind: 'error', ...error } : { kind: 'completed' }
  }

  /**
   * End a run with `outcome`. The interpreter that ran it (if any) is always
   * discarded, and a fresh one starts warming so the next run is clean.
   */
  function finish(run: ActiveRun, outcome: RunOutcome, respawn = true) {
    if (active !== run) return
    active = null
    if (run.timer) clearTimeout(run.timer)
    if (run.slot && run.slot.hasRun) {
      discard(run.slot)
      if (respawn) spawn()
    } else if (slot) {
      setState(slot.isReady ? 'ready' : 'preparing')
    }
    run.resolve({ output: run.output, outcome, outputTruncated: run.outputTruncated })
  }

  function ensureSlot(): Slot {
    if (slot && !slot.hasRun) return slot
    return spawn()
  }

  return {
    timeoutMs,

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    prepare() {
      return ensureSlot().ready
    },

    isRunInProgress: () => active !== null,

    async run(code, runOptions = {}) {
      if (active) throw new SandboxBusyError()

      let resolve!: (result: RunResult) => void
      const result = new Promise<RunResult>((r) => {
        resolve = r
      })
      const run: ActiveRun = {
        id: nextRunId++,
        output: [],
        outputTruncated: false,
        onOutput: runOptions.onOutput,
        resolve,
        slot: null,
        timer: null,
      }
      active = run

      // Posts synchronously when an interpreter is already warm; otherwise
      // waits for one. The wait is not counted against the time limit.
      let target = ensureSlot()
      while (!target.isReady || slot !== target) {
        try {
          // Racing the result lets a stop during preparation end the run now.
          await Promise.race([target.ready, result])
        } catch (error) {
          if (active === run) active = null
          throw error
        }
        // Stopped (or disposed) while waiting for the runtime: nothing to start.
        if (active !== run) return result
        // Replaced while waiting (a warm interpreter died): wait for the new one.
        if (slot !== target) target = ensureSlot()
      }

      run.slot = target
      target.hasRun = true
      target.worker.postMessage({ type: 'run', runId: run.id, code })
      setState('running')
      run.timer = setTimeout(() => finish(run, { kind: 'timed_out', limitMs: timeoutMs }), timeoutMs)
      return result
    },

    stop() {
      if (active) finish(active, { kind: 'stopped' })
    },

    dispose() {
      if (active) finish(active, { kind: 'stopped' }, false)
      if (slot) discard(slot)
      setState('idle')
    },
  }
}

let sharedRunner: SandboxRunner | null = null

/**
 * The app-wide runner. Created on first call — creating it starts nothing;
 * the worker and the runtime load on the first `prepare()` or `run()`.
 */
export function getSharedSandboxRunner(): SandboxRunner {
  sharedRunner ??= createSandboxRunner()
  return sharedRunner
}
