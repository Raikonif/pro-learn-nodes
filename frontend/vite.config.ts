import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build-time flags consumed by api-client.ts to choose between the HTTP
// localhost transport (dev) and the Unix-socket transport (production).
// `tauri build` injects VITE_API_MODE=unix so the bundled app talks to the
// sidecar over a Unix domain socket; `vite dev` / `tauri dev` keep it on
// http so the standalone dev servers work as before.
const API_MODE = process.env.VITE_API_MODE ?? 'http'
const UNIX_SOCKET_PATH = process.env.VITE_UNIX_SOCKET_PATH ?? ''

export default defineConfig({
  plugins: [react()],
  // 127.0.0.1 + strictPort is the Tauri convention: it lets the bundled
  // webview always find the dev server on the same loopback address, and
  // fails fast when the port is taken rather than silently picking another.
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  define: {
    'import.meta.env.VITE_API_MODE': JSON.stringify(API_MODE),
    'import.meta.env.VITE_UNIX_SOCKET_PATH': JSON.stringify(UNIX_SOCKET_PATH),
  },
  clearScreen: false,
})
