#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BACKEND_PORT_ENV,
  DEFAULT_BACKEND_PORT,
  DEV_HOST,
  findFreePort,
  recordBackendPort,
} from './dev-ports.mjs'

/**
 * Starts the FastAPI dev server on an allocated port.
 *
 * This process BINDS the backend port, so it is the one that allocates — and
 * therefore the one that records where it landed. A dev server started in a
 * different terminal cannot scan for the backend (its port reads as occupied,
 * which is indistinguishable from a foreign process), so it reads the record
 * this writes and verifies it. See design.md Decisions 5 and 5a.
 *
 * Pass `--reload` through for the watch loop.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const supplied = process.env[BACKEND_PORT_ENV]
  const port = supplied ? Number(supplied) : await findFreePort(DEFAULT_BACKEND_PORT)

  if (port !== DEFAULT_BACKEND_PORT) {
    console.log(
      `[learn-nodes] backend port ${port} (default ${DEFAULT_BACKEND_PORT} unavailable)`,
    )
  } else {
    console.log(`[learn-nodes] backend port ${port}`)
  }

  recordBackendPort(port)

  const backendDir = path.join(REPO_ROOT, 'backend')
  const uvicornArgs = [
    'main:app',
    '--host',
    DEV_HOST,
    '--port',
    String(port),
    ...process.argv.slice(2),
  ]

  // Keep the process tree FLAT. `uv run uvicorn` inserts a `uv` process
  // between this wrapper and the server, and killing `uv` does not reliably
  // take the server with it — orphaned backends then accumulate across E2E
  // runs, holding ports that later allocations skip past because they only
  // *look* taken.
  //
  // Detaching into a separate process group is the wrong cure: it survives the
  // group-wide kill that a supervisor like Playwright sends, which is exactly
  // how the leak was observed. Staying in the parent's group means an external
  // tree-kill reaches the server directly.
  const venvUvicorn = path.join(backendDir, '.venv', 'bin', 'uvicorn')
  const [command, args] = fs.existsSync(venvUvicorn)
    ? [venvUvicorn, uvicornArgs]
    : ['uv', ['run', 'uvicorn', ...uvicornArgs]] // fresh clone, before `uv sync`

  const child = spawn(command, args, {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, [BACKEND_PORT_ENV]: String(port) },
  })

  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0))
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      try {
        child.kill(signal)
      } catch {
        /* already exited */
      }
    })
  }
}

main().catch((error) => {
  console.error(`[learn-nodes] ${error.message}`)
  process.exit(1)
})
