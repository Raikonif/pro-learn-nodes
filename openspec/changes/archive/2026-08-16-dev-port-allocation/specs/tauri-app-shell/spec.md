## MODIFIED Requirements

### Requirement: Tauri 2 wraps the existing React frontend
The `src-tauri/` project SHALL be configured so that `frontendDist` points at `frontend/dist`. The dev server origin Tauri loads SHALL be the allocated frontend origin, supplied at launch rather than fixed in `tauri.conf.json`; any `devUrl` value committed in the config file SHALL be treated as a fallback, not as authoritative. The Tauri app SHALL load the React frontend built by the existing `frontend/` project; no React source code SHALL be moved into `src-tauri/`.

#### Scenario: Tauri dev runs the Vite dev server
- **WHEN** a developer runs `pnpm dev` from the repository root
- **THEN** ports are allocated first, Tauri starts the Vite dev server on the allocated frontend port, waits for that origin to respond, and opens a native window that renders the React app

#### Scenario: Allocated port differs from the default
- **WHEN** the default frontend port is unavailable and a different port is allocated
- **THEN** Tauri loads the allocated origin, and the window renders the app rather than failing to connect

#### Scenario: Tauri build bundles the frontend
- **WHEN** a developer runs `pnpm tauri build`
- **THEN** Tauri runs the frontend build, reads the resulting `frontend/dist/` directory, and produces a `.app` (and `.dmg` on macOS) bundle
