/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * IPC transport selected at build time. `tauri build` injects `unix` so
   * the bundled app talks to the FastAPI sidecar over a Unix domain socket;
   * `vite dev` keeps the default of `http` for the standalone Vite workflow.
   */
  readonly VITE_API_MODE?: 'http' | 'unix'
  /** Unix domain socket path used when VITE_API_MODE === "unix". */
  readonly VITE_UNIX_SOCKET_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
