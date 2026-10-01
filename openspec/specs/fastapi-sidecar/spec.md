# fastapi-sidecar Specification

## Purpose
TBD - created by archiving change phase-one-tauri-skeleton. Update Purpose after archive.
## Requirements
### Requirement: Tauri supervises the FastAPI sidecar
When `pnpm tauri build` is used, the Tauri app SHALL launch the FastAPI backend as a sidecar binary at window startup and SHALL terminate it on window close. Before making the production frontend available, Tauri SHALL wait for the sidecar's readiness endpoint to return 200, which SHALL occur only after local data initialization is complete. When `pnpm tauri dev` is used, the Tauri app SHALL connect to a backend already running on the allocated backend port and SHALL NOT spawn a duplicate sidecar.

#### Scenario: Dev mode uses an externally started backend
- **WHEN** the developer starts the backend with `pnpm run backend:dev` and then runs `pnpm tauri dev`
- **THEN** the Tauri window opens and the app reaches the existing backend on the allocated backend port; no second backend process is spawned

#### Scenario: Production build spawns a ready sidecar on launch
- **WHEN** the user double-clicks the bundled `.app`
- **THEN** the app starts the FastAPI sidecar binary, waits for its readiness endpoint to return 200 after local data initialization, opens the window, and tears the sidecar down when the window closes

### Requirement: Health and readiness report distinct startup states
The sidecar SHALL expose a lightweight health response that reports whether its process can respond, and a readiness response that returns success only after required local-data migrations and validation have completed. A failed migration or validation SHALL keep readiness unsuccessful and provide a diagnosable failure response without serving bootstrap data.

#### Scenario: Sidecar is alive but data initialization is pending
- **WHEN** the sidecar process is running while local data initialization has not completed
- **THEN** health reports the process as reachable and readiness does not report success

#### Scenario: Local data initialization fails
- **WHEN** a required local-data migration or validation fails during sidecar startup
- **THEN** readiness remains unsuccessful, bootstrap is unavailable, and the failure is recorded for diagnosis

### Requirement: HTTP transport on localhost in development
The Tauri ↔ FastAPI IPC SHALL use plain HTTP whenever the frontend is served by the Vite dev server. The browser SHALL address the Vite dev server's own origin under the `/api` prefix, and the dev server SHALL forward those requests to the backend on the allocated backend port. Dev traffic is therefore same-origin from the browser's perspective, and SHALL NOT depend on a cross-origin permission to function.

#### Scenario: HTTP localhost in dev
- **WHEN** the app mounts and `import.meta.env.VITE_API_MODE === "http"`
- **THEN** the frontend issues a `GET /api/health` against the Vite dev server origin, the dev server forwards it to the backend as `GET /health`, and the response is rendered

#### Scenario: Backend port is not hardcoded in the frontend
- **WHEN** the backend is allocated a port other than its default
- **THEN** the frontend continues to work without modification, because it addresses the dev server rather than the backend origin

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
