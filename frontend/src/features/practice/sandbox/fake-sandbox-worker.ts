/**
 * A scriptable stand-in for the Pyodide worker, for tests only. jsdom has no
 * Worker and no WebAssembly Python; the runner's ordering, stop, timeout,
 * one-run and clean-interpreter logic is exercised against this instead.
 */
import type {
  HarnessError,
  OutputChunk,
  SandboxWorkerLike,
  WorkerRequest,
  WorkerResponse,
} from './sandbox-protocol'

export class FakeSandboxWorker implements SandboxWorkerLike {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null
  onerror: ((event: { message?: string }) => void) | null = null
  received: WorkerRequest[] = []
  terminated = false

  postMessage(message: WorkerRequest): void {
    this.received.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  get runs() {
    return this.received.flatMap((m) => (m.type === 'run' ? [m] : []))
  }

  get lastRunId(): number {
    const runs = this.runs
    const run = runs[runs.length - 1]
    if (!run) throw new Error('no run was posted to this worker')
    return run.runId
  }

  respond(message: WorkerResponse): void {
    if (this.terminated) return
    this.onmessage?.({ data: message })
  }

  ready(): void {
    this.respond({ type: 'ready' })
  }

  unavailable(reason: string): void {
    this.respond({ type: 'unavailable', reason })
  }

  output(...chunks: OutputChunk[]): void {
    this.respond({ type: 'output', runId: this.lastRunId, chunks })
  }

  done(error: HarnessError | null = null): void {
    this.respond({ type: 'done', runId: this.lastRunId, error })
  }

  crash(message: string): void {
    if (this.terminated) return
    this.onerror?.({ message })
  }
}

export function createFakeWorkerFactory() {
  const workers: FakeSandboxWorker[] = []
  const createWorker = () => {
    const worker = new FakeSandboxWorker()
    workers.push(worker)
    return worker
  }
  return {
    workers,
    createWorker,
    get current(): FakeSandboxWorker {
      const worker = workers[workers.length - 1]
      if (!worker) throw new Error('no worker has been created')
      return worker
    },
  }
}
