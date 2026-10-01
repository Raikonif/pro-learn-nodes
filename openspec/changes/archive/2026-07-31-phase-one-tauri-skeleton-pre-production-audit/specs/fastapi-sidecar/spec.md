## ADDED Requirements

### Requirement: Tauri supervises the FastAPI sidecar
When `npm run tauri build` is used, the Tauri app SHALL launch the FastAPI backend as a sidecar binary at window startup and SHALL terminate it on window close. When `npm run tauri dev` is used, the Tauri app SHALL connect to a backend already running on `http://127.0.0.1:8000` and SHALL NOT spawn a duplicate sidecar.

#### Scenario: Dev mode uses an externally started backend
- **WHEN** the developer starts the backend with `npm run backend:dev` and then runs `npm run tauri dev`
- **THEN** the Tauri window opens and the placeholder screen reaches the existing backend over `http://127.0.0.1:8000/health`; no second backend process is spawned

#### Scenario: Production build spawns the sidecar on launch
- **WHEN** the user double-clicks the bundled `.app`
- **THEN** the app starts the FastAPI sidecar binary, waits for `/health` to return 200, opens the window, and tears the sidecar down when the window closes

### Requirement: HTTP transport on localhost in development
The Tauri ↔ FastAPI IPC SHALL use plain HTTP on `http://127.0.0.1:8000` whenever the frontend is served by the Vite dev server. CORS SHALL allow the dev origin.

#### Scenario: HTTP localhost in dev
- **WHEN** the placeholder screen mounts and `import.meta.env.VITE_API_MODE === "http"`
- **THEN** the frontend issues a `GET /health` against `http://127.0.0.1:8000/health` and renders the response

### Requirement: Unix socket transport in production
The Tauri ↔ FastAPI IPC SHALL use a Unix domain socket when the frontend is served from the bundled `frontend/dist/` (production builds). The socket SHALL live in a directory the app controls (e.g., the app data directory or a per-user temp path) and SHALL be cleaned up on app shutdown.

#### Scenario: Unix socket in production
- **WHEN** the bundled `.app` is launched and `import.meta.env.VITE_API_MODE === "unix"`
- **THEN** the frontend reaches the backend over the configured Unix socket path and `GET /health` returns 200

### Requirement: Single API client abstracts the transport
The frontend SHALL expose a single `apiClient` module under `frontend/src/shared/lib/` that chooses HTTP or Unix transport based on `import.meta.env.VITE_API_MODE`. No feature code SHALL construct transport-specific URLs directly.

#### Scenario: API client honors the build mode flag
- **WHEN** the placeholder screen calls `apiClient.get("/health")`
- **THEN** the call goes over HTTP in dev builds and over Unix socket in production builds, transparently to the caller

### Requirement: Response validation with Zod
Every IPC response SHALL be parsed through a Zod schema before being returned to the caller. The `/health` response SHALL be validated against `z.object({ status: z.literal("ok"), backend: z.literal("fastapi") })`.

#### Scenario: Malformed responses are rejected
- **WHEN** `/health` returns a payload that does not match the Zod schema
- **THEN** the API client throws a typed validation error and the placeholder screen renders a red status dot
