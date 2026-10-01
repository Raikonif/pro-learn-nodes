## MODIFIED Requirements

### Requirement: Tauri supervises the FastAPI sidecar
When `pnpm tauri build` is used, the Tauri app SHALL launch the FastAPI backend as a sidecar binary at window startup and SHALL terminate it on window close. When `pnpm tauri dev` is used, the Tauri app SHALL connect to a backend already running on the allocated backend port and SHALL NOT spawn a duplicate sidecar.

#### Scenario: Dev mode uses an externally started backend
- **WHEN** the developer starts the backend with `pnpm run backend:dev` and then runs `pnpm tauri dev`
- **THEN** the Tauri window opens and the app reaches the existing backend on the allocated backend port; no second backend process is spawned

#### Scenario: Production build spawns the sidecar on launch
- **WHEN** the user double-clicks the bundled `.app`
- **THEN** the app starts the FastAPI sidecar binary, waits for `/health` to return 200, opens the window, and tears the sidecar down when the window closes

### Requirement: HTTP transport on localhost in development
The Tauri ↔ FastAPI IPC SHALL use plain HTTP whenever the frontend is served by the Vite dev server. The browser SHALL address the Vite dev server's own origin under the `/api` prefix, and the dev server SHALL forward those requests to the backend on the allocated backend port. Dev traffic is therefore same-origin from the browser's perspective, and SHALL NOT depend on a cross-origin permission to function.

#### Scenario: HTTP localhost in dev
- **WHEN** the app mounts and `import.meta.env.VITE_API_MODE === "http"`
- **THEN** the frontend issues a `GET /api/health` against the Vite dev server origin, the dev server forwards it to the backend as `GET /health`, and the response is rendered

#### Scenario: Backend port is not hardcoded in the frontend
- **WHEN** the backend is allocated a port other than its default
- **THEN** the frontend continues to work without modification, because it addresses the dev server rather than the backend origin
