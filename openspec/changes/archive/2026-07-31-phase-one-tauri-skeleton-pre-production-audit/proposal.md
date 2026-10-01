## Why

Phase 0 established the repository shape: `frontend/`, `backend/`, and `src-tauri/` as siblings, each runnable on its own. But those three pieces do not yet talk to each other — `src-tauri/tauri.conf.json` points at a Vite dev URL that is not yet wired, the Tauri Rust entry has no lifecycle hook for spawning a FastAPI sidecar, and the React app renders whatever its `App.tsx` happens to render (not a Learn Nodes placeholder). Until a single command opens a real window showing real product surface — and that window can call the backend — none of the later phases can be demoed end-to-end.

Phase 1 closes the loop: Tauri 2 wraps React 19 (Vite + TS + Tailwind), manages the FastAPI backend as a sidecar, and the two sides communicate over HTTP on localhost in dev and a Unix socket in production builds. The result is a runnable artifact — `npm run tauri dev` opens a window that shows "Learn Nodes" and can reach `/health`.

## What Changes

- **Tauri 2 app shell** — `src-tauri/` already exists as a Rust project; wire it up to the existing `frontend/` directory, configure `frontendDist`/`devUrl`, and ensure `npm run tauri dev` and `npm run tauri build` both succeed.
- **React 19 + Vite + TS + Tailwind placeholder UI** — `frontend/src/app/App.tsx` renders a minimal "Learn Nodes" screen (title + subtitle + status indicator showing backend reachability). No graph, no chat, no router — just proof that the window works.
- **FastAPI sidecar lifecycle** — Tauri spawns the FastAPI process on window startup (`tauri-plugin-shell` or `tauri::async_runtime`), waits for `/health` to return 200, and shuts it down on window close. In dev, the backend is already running (started by the developer or by `npm run backend:dev`); Tauri detects which mode it is in and connects accordingly.
- **Tauri ↔ FastAPI IPC contract** — single transport for now: HTTP on `http://127.0.0.1:8000` during dev; a Unix domain socket (e.g., `/tmp/learn-nodes.sock` or app-data-dir scoped) in production builds. The frontend uses an HTTP client (Zod-validated responses) and switches endpoint based on a build-time `import.meta.env.VITE_API_MODE` flag (`http` | `unix`).
- **Tailwind wired into the build** — `frontend/tailwind.config.js`, `postcss.config.js` already exist; verify they are picked up by Vite and that the placeholder screen uses utility classes. No new design system yet.
- **Tests stay green** — the existing Vitest, Playwright e2e, and pytest suites from the `test-driven-development` change must continue to pass. The new placeholder screen adds one Vitest test (renders the title) and one Playwright spec (window opens, title visible).

**Already landed — not part of this change:**
- `frontend/` and `backend/` exist as siblings with their own `package.json` / `pyproject.toml`
- `src-tauri/` contains only Tauri config and Rust sources
- Scream architecture for frontend, layered architecture for backend
- TDD infrastructure (Vitest + Playwright + pytest)
- `/health` endpoint served from `backend/api/routes/health.py`

## Capabilities

### New Capabilities
- `tauri-app-shell`: Tauri 2 app wraps React 19 + Vite + TS + Tailwind frontend; `npm run tauri dev` opens a window, `npm run tauri build` produces a `.app`/`.dmg` bundle. Configured to use `frontend/` as the build source.
- `fastapi-sidecar`: Tauri spawns and supervises the FastAPI backend as a sidecar process; exposes the IPC transport choice (HTTP localhost in dev, Unix socket in production) as a configurable contract on the frontend.
- `phase-one-placeholder-ui`: A minimal "Learn Nodes" landing screen that proves the window works and shows a live backend reachability indicator (green dot when `/health` returns 200, red otherwise).

### Modified Capabilities
- `phase-zero-separation`: Add a Scenario clarifying that `npm run tauri dev` (run from the repo root) is the canonical end-to-end run command once Phase 1 lands, and that `npm run backend:dev` is now an optional helper used by Tauri only when running in dev mode without the sidecar.

## Impact

- **Directories affected**: `src-tauri/` (config + Rust entry), `frontend/src/app/` (placeholder screen + test), `frontend/src/shared/lib/` (HTTP client helper for the IPC transport)
- **Files modified**: `src-tauri/tauri.conf.json` (already points at `../frontend` — verify), `src-tauri/src/lib.rs` and `main.rs` (sidecar wiring), `frontend/vite.config.ts` and `frontend/src/main.tsx` (env flag exposure, base styles)
- **Files created**: `frontend/src/app/Placeholder.tsx`, `frontend/src/app/Placeholder.test.tsx`, `frontend/e2e/placeholder.spec.ts`, `frontend/src/shared/lib/api-client.ts`
- **Dependencies added**: `tauri-plugin-shell` (Tauri sidecar API), `react-icons` or `lucide-react` only if needed for the status dot; `undici`/`fetch` already in Vite/Node, no new HTTP client
- **Build impact**: `npm run tauri dev` and `npm run tauri build` become the primary run/build commands; `npm run dev` in `frontend/` and `npm run backend:dev` at the repo root remain valid for solo frontend/backend work
- **OpenSpec files updated**: `openspec/roadmap.md` Phase 1 bullets and Demo line will need to be confirmed consistent once implementation lands (the spec must end with `npm run tauri dev` → window → placeholder visible)
- **Out of scope** (later phases): windowing tricks (menubar, tray), code signing, notarization, multiple windows, deep linking, auto-updater, any real API surface beyond `/health`

## Phase 1 status (audit pass)

A review of the merged Phase 1 work — Vercel React best practices, current FastAPI guidance via Context7 — confirmed that the dev loop (`npm run tauri dev` → green dot) is complete, but the production-sidecar path is **not**. Specifically:

- `src-tauri/src/lib.rs` spawns FastAPI only in debug builds; production builds do not bundle or supervise a sidecar.
- The Unix-socket IPC branch in `frontend/src/shared/lib/api-client.ts` (`API_MODE === "unix"`) is unreachable because the Rust `api_request` command and the `tauri build` env-flag injection are not in place.

These gaps are tracked as reopened tasks in `tasks.md` § 11 and must be closed in a follow-up change before this change is archived. Do not interpret the previously all-checked task list as "production-ready"; this proposal and the dev experience are accurate, but the bundled `.app` launch path remains pending.
