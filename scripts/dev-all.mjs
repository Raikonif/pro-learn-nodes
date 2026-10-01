#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BACKEND_PORT_ENV,
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEV_HOST,
  FRONTEND_PORT_ENV,
  describePorts,
  resolvePorts,
  waitForHealthy,
} from './dev-ports.mjs'

/**
 * Starts the whole development stack from one terminal.
 *
 * The two halves cannot start concurrently. `dev.mjs` resolves the backend by
 * verifying its `/health` payload, and a check made before the backend answers
 * resolves as *absent* — producing a window that renders, reaches nothing, and
 * explains none of it. So the backend goes first, the launcher waits for a
 * verified health response, and only then does the Tauri side start.
 *
 * Both ports are allocated here, once, and handed down through the environment.
 * Each child then takes the value as supplied rather than allocating again,
 * which is what keeps the proxy and the server agreeing on a number that was
 * chosen before either of them ran.
 *
 * The per-process commands are untouched; this composes them, it does not
 * replace them.
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')

/**
 * Orchestration, with every side effect injectable.
 *
 * Returns an exit code instead of calling `process.exit` so the ordering and
 * the cleanup can be asserted without opening a window.
 */
export async function runDevStack(options = {}) {
  const {
    env = process.env,
    allocatePorts = resolvePorts,
    spawnProcess = spawn,
    waitForBackend = waitForHealthy,
    healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    log = console.log,
    logError = console.error,
    onSignal = (signal, handler) => process.on(signal, handler),
  } = options

  // A copy, so the allocation written back for the children does not leak into
  // this process's own environment.
  const childEnv = { ...env }
  const ports = await allocatePorts({ env: childEnv })

  // Handed down, not re-derived. A child that finds a port already supplied
  // treats it as authoritative and skips its own allocation, which is the only
  // reason the server and the proxy in front of it agree on a number chosen
  // before either process existed.
  childEnv[FRONTEND_PORT_ENV] = String(ports.frontend)
  childEnv[BACKEND_PORT_ENV] = String(ports.backend)

  // Printed before anything spawns: once the children own the terminal, this
  // scrolls away inside uvicorn's and Vite's output.
  log('[learn-nodes] dev stack')
  log(describePorts(ports))

  const started = []
  let stopped = false

  const stopAll = (signal) => {
    if (stopped) return
    stopped = true
    for (const { child } of started) {
      try {
        child.kill(signal)
      } catch {
        /* already exited */
      }
    }
  }

  // Registered before the first spawn. A Ctrl-C landing in the gap would
  // otherwise leave a backend running with nothing left to stop it.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    onSignal(signal, () => stopAll(signal))
  }

  const start = (name, script, args) => {
    // Node directly, not `pnpm run`: a package-manager process in between does
    // not reliably pass a kill down, and `backend.mjs` documents what orphaned
    // servers cost — held ports that later allocations skip past because they
    // only look taken. No `detached` either, for the same reason it rejects
    // one: a separate process group survives the group-wide kill a supervisor
    // sends, which is how the leak was observed in the first place.
    const child = spawnProcess(process.execPath, [path.join(SCRIPTS_DIR, script), ...args], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: childEnv,
    })

    const record = { name, child, code: undefined }
    record.exited = new Promise((resolve) => {
      child.on('exit', (code, signal) => {
        record.code = signal ? 1 : (code ?? 0)
        resolve(record)
      })
    })

    started.push(record)
    return record
  }

  const backend = start('backend', 'backend.mjs', ['--reload'])

  // The wait races the backend's own death. Without it, a backend that fails
  // to bind spends the entire health budget being probed at a port nothing
  // holds, and the developer waits a minute to be told what the traceback
  // already said.
  const diedWhileWaiting = backend.exited.then((record) => {
    throw new Error(`backend exited with code ${record.code} before answering`)
  })
  diedWhileWaiting.catch(() => {
    // Expected on the happy path, where the backend outlives the wait. Marking
    // it handled here keeps that from surfacing as an unhandled rejection.
  })

  try {
    await Promise.race([
      waitForBackend(ports.backend, { host: DEV_HOST, timeoutMs: healthTimeoutMs }),
      diedWhileWaiting,
    ])
  } catch (error) {
    // The backend's own output is already on this terminal — `stdio: 'inherit'`
    // means its traceback printed as it happened. This says which process the
    // launcher gave up on and that nothing else was started.
    logError(`[learn-nodes] backend failed to start: ${error.message}`)
    logError('[learn-nodes] not starting the app window; stopping the stack.')
    stopAll('SIGTERM')
    return 1
  }

  log(`[learn-nodes] backend healthy at http://${DEV_HOST}:${ports.backend}/health`)
  start('tauri', 'dev.mjs', [])

  // Either child exiting ends the session: a dead backend leaves the window
  // useless, and a closed window leaves the backend with no one to serve.
  const first = await Promise.race(started.map((record) => record.exited))
  stopAll('SIGTERM')
  return first.code
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  runDevStack()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`[learn-nodes] ${error.message}`)
      process.exit(1)
    })
}
