#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BACKEND_PORT_ENV,
  DEFAULT_FRONTEND_PORT,
  FRONTEND_PORT_ENV,
  discoverBackendPort,
  findFreePort,
} from './dev-ports.mjs'

/**
 * Dev launcher: allocates the frontend port, locates the backend, and starts
 * Tauri pointed at the right origin.
 *
 * The two ports are handled differently on purpose. Vite BINDS the frontend
 * port, so that one is allocated by scanning. The backend is started
 * separately (`pnpm run backend:dev`), so this process only needs to CONNECT to
 * it — scanning would skip right past a running backend, because a port in use
 * by the thing you want to reach looks identical to one held by a stranger.
 *
 * `tauri.conf.json` cannot interpolate an environment variable into `devUrl`,
 * so the allocated origin is injected with a `--config` override at launch.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const supplied = process.env[FRONTEND_PORT_ENV]
  const frontend = supplied ? Number(supplied) : await findFreePort(DEFAULT_FRONTEND_PORT)
  const frontendOrigin = `http://localhost:${frontend}`

  const env = { ...process.env, [FRONTEND_PORT_ENV]: String(frontend) }
  const backend = await discoverBackendPort({ env })
  env[BACKEND_PORT_ENV] = String(backend.port)

  console.log('[learn-nodes] dev ports')
  console.log(
    `  frontend  ${frontend}` +
      (frontend === DEFAULT_FRONTEND_PORT
        ? ''
        : ` (default ${DEFAULT_FRONTEND_PORT} unavailable)`),
  )
  console.log(
    `  backend   ${backend.port}` +
      (backend.verified ? ` (verified, from ${backend.source})` : ' (not verified)'),
  )
  if (!backend.verified) {
    // Not fatal: frontend-only work with the backend stopped has to keep
    // working. Backend requests will fail visibly at request time instead.
    console.warn(`[learn-nodes] ${backend.warning}`)
  }

  const configOverride = JSON.stringify({ build: { devUrl: frontendOrigin } })
  const child = spawn('pnpm', ['exec', 'tauri', 'dev', '--config', configOverride], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env,
  })

  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0))
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
}

main().catch((error) => {
  console.error(`[learn-nodes] ${error.message}`)
  process.exit(1)
})
