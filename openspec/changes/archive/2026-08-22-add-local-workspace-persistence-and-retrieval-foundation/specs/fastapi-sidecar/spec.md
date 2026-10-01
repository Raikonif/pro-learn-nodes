## MODIFIED Requirements

### Requirement: Tauri supervises the FastAPI sidecar
When `pnpm tauri build` is used, the Tauri app SHALL launch the FastAPI backend as a sidecar binary at window startup and SHALL terminate it on window close. Before making the production frontend available, Tauri SHALL wait for the sidecar's readiness endpoint to return 200, which SHALL occur only after local data initialization is complete. When `pnpm tauri dev` is used, the Tauri app SHALL connect to a backend already running on the allocated backend port and SHALL NOT spawn a duplicate sidecar.

#### Scenario: Dev mode uses an externally started backend
- **WHEN** the developer starts the backend with `pnpm run backend:dev` and then runs `pnpm tauri dev`
- **THEN** the Tauri window opens and the app reaches the existing backend on the allocated backend port; no second backend process is spawned

#### Scenario: Production build spawns a ready sidecar on launch
- **WHEN** the user double-clicks the bundled `.app`
- **THEN** the app starts the FastAPI sidecar binary, waits for its readiness endpoint to return 200 after local data initialization, opens the window, and tears the sidecar down when the window closes

## ADDED Requirements

### Requirement: Health and readiness report distinct startup states
The sidecar SHALL expose a lightweight health response that reports whether its process can respond, and a readiness response that returns success only after required local-data migrations and validation have completed. A failed migration or validation SHALL keep readiness unsuccessful and provide a diagnosable failure response without serving bootstrap data.

#### Scenario: Sidecar is alive but data initialization is pending
- **WHEN** the sidecar process is running while local data initialization has not completed
- **THEN** health reports the process as reachable and readiness does not report success

#### Scenario: Local data initialization fails
- **WHEN** a required local-data migration or validation fails during sidecar startup
- **THEN** readiness remains unsuccessful, bootstrap is unavailable, and the failure is recorded for diagnosis

