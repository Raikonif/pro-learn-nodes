// @vitest-environment node
/**
 * The worker core and Python harness against the REAL Pyodide from
 * node_modules — the paths the jsdom fakes cannot prove: stdout capture,
 * exception/line extraction, parse failures, and isolation between runs that
 * share one interpreter.
 *
 * Skipped by default (it boots a ~10MB WASM interpreter, a few seconds):
 *
 *   LEARN_NODES_PYODIDE_TESTS=1 pnpm test -- sandbox-real-pyodide
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { appendChunk, type HarnessError, type OutputChunk, type WorkerResponse } from './sandbox-protocol'
import { createSandboxWorkerCore, type LoadPyodideLike } from './sandbox-worker-core'

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const enabled = Boolean(env?.LEARN_NODES_PYODIDE_TESTS)

const INDEX_PATH = decodeURIComponent(
  new URL('../../../../node_modules/pyodide/', import.meta.url).pathname,
)

describe.skipIf(!enabled)('sandbox against real Pyodide', () => {
  const posted: WorkerResponse[] = []
  const core = createSandboxWorkerCore({
    importPyodide: async () => (await import('pyodide')).loadPyodide as unknown as LoadPyodideLike,
    post: (message) => posted.push(message),
    // A stand-in global so the network lock-down does not rewrite Node's own.
    scope: {},
  })
  let runId = 0

  async function run(code: string): Promise<{ output: OutputChunk[]; error: HarnessError | null }> {
    posted.length = 0
    runId += 1
    await core.handle({ type: 'run', runId, code })
    const output: OutputChunk[] = []
    for (const m of posted) if (m.type === 'output') m.chunks.forEach((c) => appendChunk(output, c))
    const done = posted.find((m) => m.type === 'done')
    if (!done || done.type !== 'done') throw new Error('run did not finish')
    return { output, error: done.error }
  }

  beforeAll(async () => {
    await core.handle({ type: 'prepare', indexURL: INDEX_PATH })
    expect(posted).toEqual([{ type: 'ready' }])
  }, 60_000)

  it('prints 1 + 1', async () => {
    expect(await run('print(1 + 1)')).toEqual({
      output: [{ stream: 'stdout', text: '2\n' }],
      error: null,
    })
  })

  it('keeps stdout and stderr in the order written', async () => {
    const { output, error } = await run(
      'import sys\nprint("a")\nprint("b", file=sys.stderr)\nprint("c")',
    )
    expect(output).toEqual([
      { stream: 'stdout', text: 'a\n' },
      { stream: 'stderr', text: 'b\n' },
      { stream: 'stdout', text: 'c\n' },
    ])
    expect(error).toBeNull()
  })

  it('reports silent success as completed with no output', async () => {
    expect(await run('x = 1')).toEqual({ output: [], error: null })
  })

  it('reports an uncaught error with type, message, line, and prior output', async () => {
    const { output, error } = await run('print("before")\n\ndef f():\n    return 1 / 0\n\nf()')
    expect(output).toEqual([{ stream: 'stdout', text: 'before\n' }])
    expect(error).toEqual({ type: 'ZeroDivisionError', message: 'division by zero', line: 4 })
  })

  it('reports unparseable code with its location and runs none of it', async () => {
    const { output, error } = await run('print("never")\nif True print(2)')
    expect(output).toEqual([])
    expect(error).toMatchObject({ type: 'SyntaxError', line: 2 })
  })

  it('gives each run a fresh namespace', async () => {
    // Full isolation (imports, mutated preloaded modules, files) comes from the
    // runner using a new worker per run; within one interpreter the harness at
    // least guarantees no name leaks from one evaluation to the next.
    await run('secret = 42')
    expect((await run('print(secret)')).error).toEqual({
      type: 'NameError',
      message: "name 'secret' is not defined",
      line: 1,
    })
  })

  it('treats sys.exit(0) as completion and input() as end of input', async () => {
    expect((await run('import sys\nprint(1)\nsys.exit(0)\nprint(2)')).error).toBeNull()
    expect((await run('input()')).error).toMatchObject({ type: 'EOFError', line: 1 })
  })
})
