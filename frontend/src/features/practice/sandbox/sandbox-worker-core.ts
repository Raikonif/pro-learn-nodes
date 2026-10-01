/**
 * The worker's logic, kept free of `self` and of Pyodide's real module so it
 * can be driven by a fake in jsdom and by the real interpreter in Node.
 *
 * `sandbox.worker.ts` is the only file that touches the worker global; it
 * wires `onmessage` to `handle` and supplies the real `importPyodide`.
 */
import { PYTHON_HARNESS } from './python-harness'
import {
  MAX_FORWARDED_OUTPUT_CHARS,
  type HarnessError,
  type OutputStream,
  type WorkerRequest,
  type WorkerResponse,
} from './sandbox-protocol'

/** The subset of Pyodide's load config this module sets. */
export type PyodideLoadConfig = {
  indexURL: string
  packageBaseUrl: string
  fullStdLib: false
  stdin: () => null
  stdout: (line: string) => void
  stderr: (line: string) => void
}

export type PyodideLike = {
  runPython(code: string): unknown
  globals: { get(name: string): unknown }
}

export type LoadPyodideLike = (config: PyodideLoadConfig) => Promise<PyodideLike>

type HarnessRun = (code: string, emit: (stream: string, text: string) => void) => unknown

export type SandboxWorkerCoreOptions = {
  /** Resolves Pyodide's `loadPyodide` from the app-served runtime directory. */
  importPyodide: (indexURL: string) => Promise<LoadPyodideLike>
  post: (message: WorkerResponse) => void
  /** The worker global; network entry points on it are disabled after load. */
  scope: Record<string, unknown>
}

/*
 * Output is posted the moment it is written, never held for a later flush.
 * A program that prints and then loops without yielding (`while True: pass`)
 * never lets this worker's event loop run again, and stopping it terminates
 * the worker — anything still buffered here would die with it, and the spec
 * requires the output produced before a stop to be shown. The per-run cap
 * (MAX_FORWARDED_OUTPUT_CHARS) is what bounds a print loop, not batching.
 */

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']
const NETWORK_DISABLED = 'Network access is disabled in the code sandbox.'

function disableNetwork(scope: Record<string, unknown>) {
  // The interpreter is fully loaded by now; nothing legitimate needs the
  // network after this point. Learner code reaching for it through the `js`
  // module gets a clear refusal instead of a request leaving the device.
  for (const name of NETWORK_GLOBALS) {
    const refuse =
      name === 'fetch'
        ? () => Promise.reject(new Error(NETWORK_DISABLED))
        : function refuse() {
            throw new Error(NETWORK_DISABLED)
          }
    try {
      scope[name] = refuse
    } catch {
      // A non-writable global stays as it is; there is nothing better to do.
    }
  }
}

function toHarnessError(value: unknown): HarnessError | null {
  if (value === null || value === undefined) return null
  let plain: unknown = value
  const proxy = value as { toJs?: (options: unknown) => unknown; destroy?: () => void }
  if (typeof proxy.toJs === 'function') {
    plain = proxy.toJs({ dict_converter: Object.fromEntries })
    proxy.destroy?.()
  }
  const record = plain as Partial<HarnessError>
  return {
    type: String(record.type ?? 'Error'),
    message: String(record.message ?? ''),
    line: typeof record.line === 'number' ? record.line : null,
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSandboxWorkerCore(options: SandboxWorkerCoreOptions) {
  const { importPyodide, post, scope } = options

  let harnessRun: HarnessRun | null = null
  // Where interpreter-level writes (not through sys.stdout) go during a run.
  let currentEmit: ((stream: OutputStream, text: string) => void) | null = null

  async function prepare(indexURL: string) {
    try {
      const loadPyodide = await importPyodide(indexURL)
      const pyodide = await loadPyodide({
        indexURL,
        packageBaseUrl: indexURL,
        fullStdLib: false,
        stdin: () => null,
        stdout: (line) => currentEmit?.('stdout', `${line}\n`),
        stderr: (line) => currentEmit?.('stderr', `${line}\n`),
      })
      pyodide.runPython(PYTHON_HARNESS)
      harnessRun = pyodide.globals.get('_learn_nodes_run') as HarnessRun
      disableNetwork(scope)
      post({ type: 'ready' })
    } catch (error) {
      post({ type: 'unavailable', reason: describe(error) })
    }
  }

  function run(runId: number, code: string) {
    if (!harnessRun) {
      post({
        type: 'done',
        runId,
        error: { type: 'SandboxError', message: 'The Python runtime is not ready.', line: null },
      })
      return
    }

    let forwarded = 0
    let truncated = false

    const emit = (stream: string, rawText: string) => {
      if (truncated) return
      const kind: OutputStream = stream === 'stderr' ? 'stderr' : 'stdout'
      const full = String(rawText)
      const text = full.slice(0, MAX_FORWARDED_OUTPUT_CHARS - forwarded)
      forwarded += text.length

      if (text) post({ type: 'output', runId, chunks: [{ stream: kind, text }] })
      if (text.length < full.length) {
        truncated = true
        post({ type: 'output-truncated', runId })
      }
    }

    currentEmit = emit
    let error: HarnessError | null
    try {
      error = toHarnessError(harnessRun(code, emit))
    } catch (thrown) {
      error = { type: 'SandboxError', message: describe(thrown), line: null }
    } finally {
      currentEmit = null
    }
    post({ type: 'done', runId, error })
  }

  return {
    async handle(message: WorkerRequest) {
      if (message.type === 'prepare') await prepare(message.indexURL)
      else if (message.type === 'run') run(message.runId, message.code)
    },
  }
}
