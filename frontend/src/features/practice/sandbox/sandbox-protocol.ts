/**
 * Types shared by the main-thread runner and the worker that hosts Python.
 *
 * Everything here crosses a `postMessage` boundary, so it is plain data: no
 * classes, no functions, nothing the structured-clone algorithm would drop.
 */

export type OutputStream = 'stdout' | 'stderr'

/** One contiguous piece of output, in the order the program produced it. */
export type OutputChunk = {
  stream: OutputStream
  text: string
}

/**
 * How a run ended.
 *
 * - `completed` — the program ran to the end (with or without output).
 * - `error` — an uncaught exception, or code that could not be parsed (in
 *   which case nothing executed). `line` is the line in the learner's buffer,
 *   or `null` when the failure has no location in it.
 * - `stopped` — the learner stopped it.
 * - `timed_out` — it exceeded the fixed limit, named here in milliseconds.
 */
export type RunOutcome =
  | { kind: 'completed' }
  | { kind: 'error'; type: string; message: string; line: number | null }
  | { kind: 'stopped' }
  | { kind: 'timed_out'; limitMs: number }

export type RunResult = {
  /** Every chunk received before the run ended, in production order. */
  output: OutputChunk[]
  outcome: RunOutcome
  /**
   * True when the program wrote more than the worker forwards
   * (`MAX_FORWARDED_OUTPUT_CHARS`); the output kept is the leading part.
   */
  outputTruncated: boolean
}

/** Errors reported by the Python harness (exceptions and parse failures). */
export type HarnessError = { type: string; message: string; line: number | null }

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type WorkerRequest =
  | { type: 'prepare'; indexURL: string }
  | { type: 'run'; runId: number; code: string }

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: string }
  | { type: 'output'; runId: number; chunks: OutputChunk[] }
  | { type: 'output-truncated'; runId: number }
  | { type: 'done'; runId: number; error: HarnessError | null }

/**
 * The slice of `Worker` the runner uses. Declared structurally so tests can
 * inject a fake: jsdom has no workers and no WebAssembly Python.
 */
export interface SandboxWorkerLike {
  postMessage(message: WorkerRequest): void
  terminate(): void
  onmessage: ((event: { data: WorkerResponse }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

/**
 * The worker forwards at most this much output per run. It bounds memory and
 * message traffic for a program that prints in a loop; what the tool renders
 * is bounded more tightly still (see `result-truncation.ts`).
 */
/**
 * Adds a chunk to a run's output, joining it to the previous one when both
 * are the same stream. The worker posts every write as it happens — Python's
 * `print` alone writes the text and the newline separately — so the output a
 * run reports is rebuilt here, on the receiving side, in one way everywhere.
 */
export function appendChunk(output: OutputChunk[], chunk: OutputChunk): void {
  const last = output[output.length - 1]
  if (last && last.stream === chunk.stream) last.text += chunk.text
  else output.push({ ...chunk })
}

export const MAX_FORWARDED_OUTPUT_CHARS = 1_000_000
