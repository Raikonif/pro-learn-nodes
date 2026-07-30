## ADDED Requirements

### Requirement: Tauri 2 wraps the existing React frontend
The `src-tauri/` project SHALL be configured so that `frontendDist` points at `frontend/dist` and `devUrl` points at the Vite dev server (`http://localhost:1420`). The Tauri app SHALL load the React frontend built by the existing `frontend/` project; no React source code SHALL be moved into `src-tauri/`.

#### Scenario: Tauri dev runs the Vite dev server
- **WHEN** a developer runs `npm run tauri dev` from the repository root
- **THEN** Tauri starts the Vite dev server as configured by `frontend/package.json`, waits for `http://localhost:1420` to respond, and opens a native window that renders the React app

#### Scenario: Tauri build bundles the frontend
- **WHEN** a developer runs `npm run tauri build`
- **THEN** Tauri runs `npm run build` in `frontend/`, reads the resulting `frontend/dist/` directory, and produces a `.app` (and `.dmg` on macOS) bundle

### Requirement: Window opens with the Learn Nodes title
The Tauri window configuration SHALL set the window title to "Learn Nodes", default size to 1200×800, and SHALL be resizable. The window SHALL appear within 5 seconds of `npm run tauri dev` being invoked on a developer machine.

#### Scenario: Window opens with correct title
- **WHEN** the developer triggers `npm run tauri dev`
- **THEN** a resizable native window titled "Learn Nodes" appears within 5 seconds and is focused

### Requirement: Frontend uses React 19, Vite, TypeScript, and Tailwind
The frontend SHALL continue to use React 19, Vite as the dev server and bundler, TypeScript in strict mode, and Tailwind CSS for styling. No new frontend framework SHALL be introduced in this change.

#### Scenario: Stack remains React 19 + Vite + TS + Tailwind
- **WHEN** the developer inspects `frontend/package.json`
- **THEN** the dependencies list React 19, Vite 6+, TypeScript 5+, and Tailwind 3+, and no new view-layer library has been added

### Requirement: Existing tests stay green
Vitest, Playwright, and pytest suites that pass before this change SHALL continue to pass after this change. The change SHALL add one new Vitest test for the placeholder screen and one new Playwright spec that verifies the window opens and renders the title.

#### Scenario: All suites remain green
- **WHEN** the developer runs `npm test`, `npm run playwright`, and `uv run pytest` after the change
- **THEN** every previously passing test still passes, the new placeholder Vitest test passes, and the new Playwright placeholder spec passes
