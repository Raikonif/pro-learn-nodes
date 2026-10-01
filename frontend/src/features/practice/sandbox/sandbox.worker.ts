/**
 * Worker entry point: the only file that touches the worker global.
 *
 * Pyodide is imported at runtime from the app-served runtime directory (the
 * `indexURL` the main thread sends with `prepare`), not bundled — the bundler
 * never sees it, and nothing is fetched until `prepare` arrives.
 */
import type { WorkerRequest, WorkerResponse } from './sandbox-protocol'
import { createSandboxWorkerCore, type LoadPyodideLike } from './sandbox-worker-core'

type WorkerScope = {
  postMessage(message: WorkerResponse): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

const scope = self as unknown as WorkerScope

const core = createSandboxWorkerCore({
  importPyodide: async (indexURL) => {
    const module = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as {
      loadPyodide: LoadPyodideLike
    }
    return module.loadPyodide
  },
  post: (message) => scope.postMessage(message),
  scope: self as unknown as Record<string, unknown>,
})

scope.onmessage = (event) => {
  void core.handle(event.data)
}
