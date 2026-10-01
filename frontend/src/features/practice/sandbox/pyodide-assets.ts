/**
 * Where the Python runtime is served from: the application itself.
 *
 * The files below are copied out of `node_modules/pyodide` by
 * `frontend/vite-plugins/pyodide-assets.ts` — served by the dev server and
 * emitted into the production build under `/pyodide/` — so loading Python
 * never asks a host outside the app for anything, and works offline.
 */

/** Directory, relative to the app's base URL, holding the runtime. */
export const PYODIDE_ASSET_DIR = 'pyodide/'

/**
 * The runtime core and nothing more: loader, WASM module, standard library,
 * and the lock file Pyodide reads at start-up. No scientific package ships.
 */
export const PYODIDE_RUNTIME_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
] as const

/**
 * The absolute URL of the runtime directory on the app's own origin.
 *
 * Resolved on the main thread and handed to the worker, whose own location
 * (a bundled chunk) would otherwise be the base for a relative path.
 */
export function resolvePyodideIndexURL(
  baseUrl: string = import.meta.env.BASE_URL,
  pageUrl: string = globalThis.location.href,
): string {
  return new URL(`${baseUrl}${PYODIDE_ASSET_DIR}`, pageUrl).href
}
