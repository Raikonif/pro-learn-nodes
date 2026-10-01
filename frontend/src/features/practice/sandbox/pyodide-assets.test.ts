import { describe, expect, it } from 'vitest'

import { createFakeWorkerFactory } from './fake-sandbox-worker'
import { PYODIDE_RUNTIME_FILES, resolvePyodideIndexURL } from './pyodide-assets'
import { createSandboxRunner } from './sandbox-runner'

/** The one host a run may reach: the one serving the application. */
function sameHost(url: string, pageUrl: string) {
  const a = new URL(url)
  const b = new URL(pageUrl)
  return a.protocol === b.protocol && a.host === b.host
}

describe('the Python runtime is served by the application (8.8)', () => {
  it('resolves the runtime directory on the dev server origin', () => {
    const page = 'http://127.0.0.1:5177/'
    const url = resolvePyodideIndexURL('/', page)

    expect(url).toBe('http://127.0.0.1:5177/pyodide/')
    expect(sameHost(url, page)).toBe(true)
  })

  it('resolves the runtime directory inside the packaged app', () => {
    const page = 'tauri://localhost/index.html'
    const url = resolvePyodideIndexURL('/', page)

    expect(url).toBe('tauri://localhost/pyodide/')
    expect(sameHost(url, page)).toBe(true)
  })

  it('stays on the app origin with a relative base', () => {
    const page = 'http://127.0.0.1:5177/app/index.html'

    expect(resolvePyodideIndexURL('./', page)).toBe('http://127.0.0.1:5177/app/pyodide/')
  })

  it('a run asks the worker to load from the page origin and nowhere else', async () => {
    const factory = createFakeWorkerFactory()
    const runner = createSandboxRunner({ createWorker: factory.createWorker })

    const run = runner.run('print(1)')
    const requests = factory.workers.flatMap((w) => w.received)
    factory.current.ready()
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    factory.current.done()
    await run

    const prepares = requests.filter((r) => r.type === 'prepare')
    expect(prepares).toHaveLength(1)
    for (const prepare of prepares) {
      if (prepare.type !== 'prepare') continue
      expect(sameHost(prepare.indexURL, globalThis.location.href)).toBe(true)
      expect(prepare.indexURL).not.toMatch(/jsdelivr|cdn|pypi/i)
    }
    runner.dispose()
  })

  it('ships only the runtime core — no scientific packages', () => {
    expect([...PYODIDE_RUNTIME_FILES].sort()).toEqual([
      'pyodide-lock.json',
      'pyodide.asm.mjs',
      'pyodide.asm.wasm',
      'pyodide.mjs',
      'python_stdlib.zip',
    ])
  })
})
