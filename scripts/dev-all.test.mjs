import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from './dev-ports.mjs'
import { runDevStack } from './dev-all.mjs'

/**
 * The launcher is tested through injected seams rather than by running it:
 * spawning for real would open a Tauri window and start uvicorn, and the
 * behaviour under test — *ordering* and *cleanup* — is precisely what a real
 * run makes hardest to observe. Every child here is a fake whose kills are
 * recorded, so "no orphans" becomes an assertion instead of an inspection.
 */
class FakeChild extends EventEmitter {
  constructor(command, args) {
    super()
    this.command = command
    this.args = args
    this.signals = []
  }

  kill(signal) {
    this.signals.push(signal)
    return true
  }

  /** Stand in for the OS reporting this process gone. */
  finish(code = 0, signal = null) {
    this.emit('exit', code, signal)
  }
}

const scriptOf = (child) =>
  (child.args.find((arg) => arg.endsWith('.mjs')) ?? '').split('/').pop()

const backendChild = (spawned) => spawned.find((c) => scriptOf(c) === 'backend.mjs')
const tauriChild = (spawned) => spawned.find((c) => scriptOf(c) === 'dev.mjs')

/** Let every already-queued microtask and timer callback drain. */
async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

function harness(overrides = {}) {
  const spawned = []
  const logs = []
  const errors = []
  const signalHandlers = new Map()

  const options = {
    env: {},
    allocatePorts: async () => ({
      frontend: DEFAULT_FRONTEND_PORT,
      backend: DEFAULT_BACKEND_PORT,
      frontendIsDefault: true,
      backendIsDefault: true,
    }),
    spawnProcess: (command, args, spawnOptions) => {
      const child = new FakeChild(command, args)
      child.spawnOptions = spawnOptions
      child.logsAtSpawn = logs.length
      spawned.push(child)
      return child
    },
    waitForBackend: async () => ({ port: DEFAULT_BACKEND_PORT, attempts: 1 }),
    log: (line) => logs.push(String(line)),
    logError: (line) => errors.push(String(line)),
    onSignal: (signal, handler) => signalHandlers.set(signal, handler),
    ...overrides,
  }

  return { options, spawned, logs, errors, signalHandlers }
}

test('the Tauri side is started only after the health wait resolves', async () => {
  let healthy
  const gate = new Promise((resolve) => {
    healthy = resolve
  })
  const h = harness({ waitForBackend: () => gate })

  const run = runDevStack(h.options)
  await settle()

  assert.equal(h.spawned.length, 1, 'nothing but the backend may start before the wait ends')
  assert.equal(scriptOf(h.spawned[0]), 'backend.mjs')

  healthy({ port: DEFAULT_BACKEND_PORT, attempts: 3 })
  await settle()

  assert.equal(h.spawned.length, 2)
  assert.equal(scriptOf(h.spawned[1]), 'dev.mjs')

  tauriChild(h.spawned).finish(0)
  assert.equal(await run, 0)
})

test('a backend that never becomes healthy fails without starting Tauri', async () => {
  const h = harness({
    waitForBackend: async () => {
      throw new Error('Backend did not answer on http://127.0.0.1:8009/health within 60s')
    },
  })

  const code = await runDevStack(h.options)

  assert.notEqual(code, 0, 'a stack that never came up must not report success')
  assert.equal(h.spawned.length, 1, 'the dependent process must not be started')
  assert.match(h.errors.join('\n'), /backend/i)
})

test('the backend is stopped when the health wait times out', async () => {
  const h = harness({
    waitForBackend: async () => {
      throw new Error('Backend did not answer within 60s')
    },
  })

  await runDevStack(h.options)

  assert.deepEqual(backendChild(h.spawned).signals, ['SIGTERM'])
})

test('the backend is stopped when the Tauri side exits', async () => {
  const h = harness()
  const run = runDevStack(h.options)
  await settle()

  tauriChild(h.spawned).finish(3)

  assert.equal(await run, 3, "the launcher reports its child's exit code")
  assert.ok(backendChild(h.spawned).signals.length > 0, 'the backend must not outlive the window')
})

test('SIGINT stops every started child', async () => {
  const h = harness()
  const run = runDevStack(h.options)
  await settle()

  h.signalHandlers.get('SIGINT')()

  for (const child of h.spawned) {
    assert.deepEqual(child.signals, ['SIGINT'], `${scriptOf(child)} was not signalled`)
  }

  for (const child of h.spawned) child.finish(null, 'SIGINT')
  await run
})

test('children stay in the launcher process group', async () => {
  // `backend.mjs` explains why: a detached group survives the group-wide kill a
  // supervisor sends, which is how orphaned backends came to hold ports that
  // later allocations skipped past because they only looked taken.
  const h = harness()
  const run = runDevStack(h.options)
  await settle()

  for (const child of h.spawned) {
    assert.notEqual(child.spawnOptions.detached, true, `${scriptOf(child)} was detached`)
  }

  tauriChild(h.spawned).finish(0)
  await run
})

test('startup reports each address before handing over the terminal', async () => {
  const h = harness({
    allocatePorts: async () => ({
      frontend: DEFAULT_FRONTEND_PORT + 2,
      backend: DEFAULT_BACKEND_PORT + 3,
      frontendIsDefault: false,
      backendIsDefault: false,
    }),
  })

  const run = runDevStack(h.options)
  await settle()

  const report = h.logs.join('\n')
  assert.match(report, new RegExp(`${DEFAULT_FRONTEND_PORT + 2}`))
  assert.match(report, new RegExp(`${DEFAULT_BACKEND_PORT + 3}`))
  assert.match(report, new RegExp(`default ${DEFAULT_FRONTEND_PORT} unavailable`))
  assert.match(report, new RegExp(`default ${DEFAULT_BACKEND_PORT} unavailable`))

  // Reported *before* the children start, or it is lost in their output.
  assert.ok(h.spawned[0].logsAtSpawn > 0, 'the report must precede the first spawn')

  tauriChild(h.spawned).finish(0)
  await run
})

test('the allocated ports are handed down so no child re-allocates', async () => {
  const h = harness({ env: { PATH: '/usr/bin' } })
  const run = runDevStack(h.options)
  await settle()

  for (const child of h.spawned) {
    assert.equal(child.spawnOptions.env.LEARN_NODES_FRONTEND_PORT, String(DEFAULT_FRONTEND_PORT))
    assert.equal(child.spawnOptions.env.LEARN_NODES_BACKEND_PORT, String(DEFAULT_BACKEND_PORT))
    assert.equal(child.spawnOptions.env.PATH, '/usr/bin', 'the real environment must survive')
  }

  tauriChild(h.spawned).finish(0)
  await run
})

test('a backend that exits before answering fails the launch', async () => {
  // The wait would otherwise burn its whole budget probing a port belonging to
  // a process that is already gone.
  const h = harness({ waitForBackend: () => new Promise(() => {}) })
  const run = runDevStack(h.options)
  await settle()

  backendChild(h.spawned).finish(1)

  assert.notEqual(await run, 0)
  assert.equal(h.spawned.length, 1)
  assert.match(h.errors.join('\n'), /backend/i)
})
