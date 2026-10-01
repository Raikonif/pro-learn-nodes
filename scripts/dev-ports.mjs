import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Development port allocation.
 *
 * Every consumer in the dev loop — uvicorn, Vite, the Tauri `devUrl`, and
 * Playwright — needs to agree on two ports, and three of them need the value
 * *before* Vite binds. So allocation happens once, up front, and the result is
 * handed to everything else. Nothing here discovers a port by parsing another
 * process's output or by retrying a connection.
 *
 * `strictPort` stays on in Vite deliberately: allocation already proved the
 * port was free, so a conflict at bind time is a race or a stale process and
 * should fail loudly rather than silently move somewhere no one else knows to
 * look. That TOCTOU window is accepted, not solved — closing it would mean
 * holding the socket open across the handoff to a different process.
 */

export const DEFAULT_FRONTEND_PORT = 5177
export const DEFAULT_BACKEND_PORT = 8009

export const FRONTEND_PORT_ENV = 'LEARN_NODES_FRONTEND_PORT'
export const BACKEND_PORT_ENV = 'LEARN_NODES_BACKEND_PORT'

/** How far to scan upward from a preferred port before giving up. */
export const DEFAULT_SCAN_LIMIT = 100

/** Loopback only. The app never binds a routable interface. */
export const DEV_HOST = '127.0.0.1'

/**
 * True when nothing is listening on `port`.
 *
 * Binds the same host the real servers bind, so the answer reflects what
 * uvicorn and Vite will actually encounter. `exclusive: true` prevents Node's
 * cluster module from handing back a shared handle and reporting a port free
 * when it is not.
 */
export function isPortFree(port, host = DEV_HOST) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen({ port, host, exclusive: true })
  })
}

/**
 * First available port at or above `preferred`.
 *
 * Scans upward rather than picking a random high port so the chosen value stays
 * predictable: a developer who finds 8009 taken can reasonably guess 8010.
 *
 * @throws when the scan range is exhausted — never falls back to an arbitrary
 *   port, because a port nobody can predict is worse than a clear failure.
 */
export async function findFreePort(preferred, options = {}) {
  const { limit = DEFAULT_SCAN_LIMIT, exclude = [], host = DEV_HOST } = options
  const taken = new Set(exclude)

  for (let port = preferred; port < preferred + limit; port += 1) {
    if (taken.has(port)) continue
    if (await isPortFree(port, host)) return port
  }

  throw new Error(
    `No free port found in range ${preferred}-${preferred + limit - 1}. ` +
      `Free a port in that range, or set ${FRONTEND_PORT_ENV}/${BACKEND_PORT_ENV} explicitly.`,
  )
}

function readPortFromEnv(env, key) {
  const raw = env[key]
  if (raw === undefined || raw === '') return undefined
  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${key} must be an integer between 1 and 65535, got "${raw}"`)
  }
  return port
}

/**
 * Resolve both dev ports, allocating only what was not already supplied.
 *
 * Supplied values win. That single rule covers both entry paths: `pnpm dev`
 * resolves once in the launcher and every child inherits, while a standalone
 * `playwright test` finds nothing in the environment and allocates for its own
 * process tree. A consumer never re-allocates over a value it was given, so
 * wherever a launcher exists its choice is authoritative.
 *
 * Writes the result back into `env` so spawned children inherit it.
 */
export async function resolvePorts(options = {}) {
  const { env = process.env, limit = DEFAULT_SCAN_LIMIT, host = DEV_HOST } = options

  const suppliedFrontend = readPortFromEnv(env, FRONTEND_PORT_ENV)
  const suppliedBackend = readPortFromEnv(env, BACKEND_PORT_ENV)

  const frontend =
    suppliedFrontend ?? (await findFreePort(DEFAULT_FRONTEND_PORT, { limit, host }))

  // `exclude` guarantees the two never land on the same port even if the
  // defaults were ever brought close together or the scan ranges overlapped.
  const backend =
    suppliedBackend ??
    (await findFreePort(DEFAULT_BACKEND_PORT, { limit, host, exclude: [frontend] }))

  env[FRONTEND_PORT_ENV] = String(frontend)
  env[BACKEND_PORT_ENV] = String(backend)

  return {
    frontend,
    backend,
    frontendOrigin: `http://localhost:${frontend}`,
    backendOrigin: `http://${DEV_HOST}:${backend}`,
    frontendIsDefault: frontend === DEFAULT_FRONTEND_PORT,
    backendIsDefault: backend === DEFAULT_BACKEND_PORT,
  }
}

// ── Discovery ────────────────────────────────────────────────────────────
//
// Allocation answers "which port is free?". Connecting to an already-running
// server asks the opposite question — "where is it listening?" — and
// availability scanning gives exactly the wrong answer there: the backend's own
// port reads as occupied, so a scanning consumer would skip past it and proxy
// to nothing. Consumers that only connect discover instead of allocate.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Written by whoever binds the backend; read by separately launched consumers. */
export const BACKEND_PORT_RECORD = path.join(REPO_ROOT, '.dev-ports.json')

export function recordBackendPort(port, file = BACKEND_PORT_RECORD) {
  try {
    fs.writeFileSync(file, `${JSON.stringify({ backend: port }, null, 2)}\n`)
  } catch {
    // Advisory only. A consumer that cannot read the record falls back to the
    // default and verifies it, so failing to write must not stop the backend.
  }
}

export function readRecordedBackendPort(file = BACKEND_PORT_RECORD) {
  try {
    const port = JSON.parse(fs.readFileSync(file, 'utf8')).backend
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
  } catch {
    return undefined
  }
}

/**
 * True when this application's backend — not merely *something* — answers on
 * `port`.
 *
 * Checking the payload rather than just reachability is the whole point. A
 * stale record and an unrelated service squatting on the port are both live
 * hazards, and the second is the exact failure that motivated this change: an
 * unrelated container on the old default port answered 200 with HTML and the
 * E2E suite reported it as a product bug.
 */
export async function verifyBackend(port, { host = DEV_HOST, timeoutMs = 1000 } = {}) {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const body = await response.json()
    return body?.status === 'ok' && body?.backend === 'fastapi'
  } catch {
    return false
  }
}

/**
 * Locate the running backend: supplied value, then recorded, then the default —
 * each verified before it is accepted.
 *
 * Never fails. Frontend-only work with the backend deliberately stopped has to
 * keep working (`phase-zero-separation`), so an exhausted candidate list yields
 * the default plus a warning, and backend requests fail visibly at request time
 * instead of at startup.
 */
export async function discoverBackendPort(options = {}) {
  const {
    env = process.env,
    file = BACKEND_PORT_RECORD,
    host = DEV_HOST,
    verify = verifyBackend,
  } = options

  const supplied = readPortFromEnv(env, BACKEND_PORT_ENV)
  if (supplied !== undefined) {
    // Authoritative by contract, not by probe. A value handed down inside the
    // process tree comes from whoever allocated it, and that server may not be
    // listening *yet* — a launcher starts its children concurrently. Probing
    // here would reject a port that is about to become correct and fall back to
    // one that is merely already occupied. That is precisely how the E2E suite
    // came to proxy at an unrelated squatter while reporting green.
    return { port: supplied, source: 'environment', verified: true, probed: false }
  }

  const candidates = []
  const recorded = readRecordedBackendPort(file)
  if (recorded !== undefined) {
    candidates.push({ port: recorded, source: 'recorded' })
  }
  if (!candidates.some((c) => c.port === DEFAULT_BACKEND_PORT)) {
    candidates.push({ port: DEFAULT_BACKEND_PORT, source: 'default' })
  }

  for (const candidate of candidates) {
    if (await verify(candidate.port, { host })) {
      return { ...candidate, verified: true, probed: true }
    }
  }

  return {
    port: DEFAULT_BACKEND_PORT,
    source: 'default',
    verified: false,
    tried: candidates,
    warning:
      `No backend verified on ${candidates.map((c) => `${c.port} (${c.source})`).join(', ')}. ` +
      `Falling back to ${DEFAULT_BACKEND_PORT}; backend requests will fail until one is running.`,
  }
}

/** How long a combined launcher waits for a backend it just started. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 60_000

/** Gap between probes while waiting. Short enough to feel immediate. */
export const DEFAULT_HEALTH_INTERVAL_MS = 250

/**
 * Block until this application's backend answers on `port`.
 *
 * `discoverBackendPort` asks "is it there *now*?" and accepts the answer no.
 * A launcher that starts the backend itself is in the opposite position: the
 * answer is no only because it asked too early, and treating that as absence
 * produces the failure this exists to prevent — a window that renders, reaches
 * nothing, and reports nothing about why.
 *
 * The probe is `verifyBackend`, unchanged and unweakened. Waiting on an open
 * socket instead would end the moment a stranger's port accepts a connection,
 * so the payload is what ends the wait, exactly as it is what ends discovery.
 *
 * @throws when the budget is spent — bounded, because a wait that never ends
 *   is indistinguishable from a hang and gives the developer nothing to act on.
 */
export async function waitForHealthy(port, options = {}) {
  const {
    host = DEV_HOST,
    timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    intervalMs = DEFAULT_HEALTH_INTERVAL_MS,
    verify = verifyBackend,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options

  const startedAt = now()
  let attempts = 0

  for (;;) {
    attempts += 1
    if (await verify(port, { host })) {
      return { port, attempts, elapsedMs: now() - startedAt }
    }

    // Checked after the probe, not before it: a budget of zero should still buy
    // one look, and a backend that answers on the last attempt has started.
    const elapsedMs = now() - startedAt
    if (elapsedMs >= timeoutMs) {
      throw new Error(
        `Backend did not answer on http://${host}:${port}/health within ${Math.round(timeoutMs / 1000)}s ` +
          `(${attempts} attempts). It may still be starting, or something else may be holding the port.`,
      )
    }

    await sleep(intervalMs)
  }
}

/** One line per port, marking any that had to move off its default. */
export function describePorts(ports) {
  const note = (isDefault, fallbackFrom) =>
    isDefault ? '' : ` (default ${fallbackFrom} unavailable)`
  return [
    `  frontend  ${ports.frontend}${note(ports.frontendIsDefault, DEFAULT_FRONTEND_PORT)}`,
    `  backend   ${ports.backend}${note(ports.backendIsDefault, DEFAULT_BACKEND_PORT)}`,
  ].join('\n')
}
