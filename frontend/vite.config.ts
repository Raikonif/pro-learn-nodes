import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import {
  DEFAULT_FRONTEND_PORT,
  DEV_HOST,
  FRONTEND_PORT_ENV,
  discoverBackendPort,
} from '../scripts/dev-ports.mjs'
import { pyodideAssets } from './vite-plugins/pyodide-assets'

// Build-time flags consumed by api-client.ts to choose between the HTTP
// localhost transport (dev) and the Unix-socket transport (production).
// `tauri build` injects VITE_API_MODE=unix so the bundled app talks to the
// sidecar over a Unix domain socket; `vite dev` / `tauri dev` keep it on
// http so the standalone dev servers work as before.
const API_MODE = process.env.VITE_API_MODE ?? 'http'
const UNIX_SOCKET_PATH = process.env.VITE_UNIX_SOCKET_PATH ?? ''

// Vite *binds* the frontend port, so it takes the value the launcher already
// allocated (every child of `pnpm dev` inherits it) rather than allocating
// again. A standalone `vite dev` finds nothing in the environment and falls
// back to the documented default.
const frontendPort = Number(process.env[FRONTEND_PORT_ENV]) || DEFAULT_FRONTEND_PORT

// Async so backend discovery — which makes a real request — can be awaited
// before the server config is built.
export default defineConfig(async () => {
  // The backend is *connected to*, never bound here, so it is discovered rather
  // than allocated (design.md Decision 5). Availability scanning would give the
  // exact wrong answer: a running backend's port reads as occupied, so a scan
  // would skip past it and point the proxy at nothing.
  const backend = await discoverBackendPort()
  if (!backend.verified) {
    // Warn but start anyway — frontend-only work with the backend deliberately
    // stopped has to keep working, so backend requests fail visibly at request
    // time instead of blocking startup (design.md Decision 5a).
    console.warn(`[vite] ${backend.warning}`)
  }

  return {
    // pyodideAssets serves the code sandbox's Python runtime from the app
    // itself (dev) and emits it into the build under /pyodide/ — never a CDN.
    plugins: [react(), pyodideAssets()],
    // The sandbox worker loads Pyodide with a runtime `import()`, which needs
    // an ES-module worker rather than the default classic IIFE bundle.
    worker: { format: 'es' as const },
    // 127.0.0.1 + strictPort is the Tauri convention: it lets the bundled
    // webview always find the dev server on the same loopback address.
    // strictPort stays on because allocation already proved the port free — a
    // conflict at bind time is a race or a stale process and must fail loudly
    // rather than silently move somewhere no other consumer knows to look
    // (design.md Decision 4).
    server: {
      host: DEV_HOST,
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://${DEV_HOST}:${backend.port}`,
          changeOrigin: true,
          // The prefix exists only between the browser and this dev server: it
          // keeps browser traffic same-origin (no CORS) without changing a
          // single backend route, so `/api/health` reaches FastAPI's existing
          // `/health`.
          rewrite: (path: string) => path.replace(/^\/api/, ''),
        },
      },
    },
    define: {
      'import.meta.env.VITE_API_MODE': JSON.stringify(API_MODE),
      'import.meta.env.VITE_UNIX_SOCKET_PATH': JSON.stringify(UNIX_SOCKET_PATH),
    },
    clearScreen: false,
  }
})
