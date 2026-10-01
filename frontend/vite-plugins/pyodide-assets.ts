import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import type { Plugin } from 'vite'

import {
  PYODIDE_ASSET_DIR,
  PYODIDE_RUNTIME_FILES,
} from '../src/features/practice/sandbox/pyodide-assets'

/**
 * Serves the Python runtime from the application itself (design.md: "The
 * runtime is vendored and lazy-loaded, never fetched from a network").
 *
 * - `vite dev`: requests under `<base>pyodide/` are answered straight from
 *   `node_modules/pyodide`.
 * - `vite build`: the same files are emitted into the output under
 *   `pyodide/`, so they ship inside the Tauri bundle.
 *
 * The files come from the pinned `pyodide` dependency at build time; no
 * binary is committed to the repository. Only `PYODIDE_RUNTIME_FILES` are
 * exposed — no scientific packages, no console pages.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.json': 'application/json',
}

function pyodideDir(): string {
  const require = createRequire(import.meta.url)
  return path.dirname(require.resolve('pyodide/package.json'))
}

export function pyodideAssets(): Plugin {
  const files = new Set<string>(PYODIDE_RUNTIME_FILES)
  let base = '/'

  return {
    name: 'learn-nodes:pyodide-assets',

    configResolved(config) {
      base = config.base
    },

    configureServer(server) {
      const dir = pyodideDir()
      const prefix = `${base}${PYODIDE_ASSET_DIR}`
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (!pathname.startsWith(prefix)) return next()
        const name = pathname.slice(prefix.length)
        if (!files.has(name)) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream')
        res.end(readFileSync(path.join(dir, name)))
      })
    },

    generateBundle() {
      const dir = pyodideDir()
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          fileName: `${PYODIDE_ASSET_DIR}${name}`,
          source: readFileSync(path.join(dir, name)),
        })
      }
    },
  }
}
