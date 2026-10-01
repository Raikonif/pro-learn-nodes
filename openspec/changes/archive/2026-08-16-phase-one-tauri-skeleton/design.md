## Context

The project is mid-Phase 1 of 15 planned phases. The Phase 0 changes have already landed:

- `frontend/` (React 19 + Vite + TS + Tailwind, Vitest + Playwright, scream architecture under `src/features/` + `src/shared/` + `src/app/`) is a sibling at the repo root, with its own `package.json`
- `backend/` (FastAPI, SQLModel, Pydantic v2, uv-managed, layered architecture `api/service/repository/models/core`, pytest) is a sibling, with its own `pyproject.toml`. The sole live endpoint `/health` is served from `backend/api/routes/health.py`
- `src-tauri/` is a Tauri 2 Rust project with `tauri-plugin-shell` and `tauri-plugin-log` already in `Cargo.toml`, plus a `tauri.conf.json` that already points `frontendDist` at `../frontend/dist` and `devUrl` at `http://localhost:1420`
- `npm run tauri dev` and `npm run tauri build` are wired at the repo root via `@tauri-apps/cli`
- `openspec/tech-stack.md` documents the IPC contract: HTTP on localhost in dev, Unix socket in production
- TDD infrastructure exists: Vitest unit, Playwright e2e, pytest — all currently green

What has not landed:

- A React screen that actually loads inside the Tauri window (the placeholder does not exist yet)
- A Tauri lifecycle hook for the FastAPI sidecar (the Rust entry has no `setup` callback)
- A typed API client that abstracts the HTTP/Unix transport
- A single canonical end-to-end run command documented in the spec

Phase 1 closes the loop. The deliverable is `npm run tauri dev` → window opens → "Learn Nodes" visible → green status dot when the backend is reachable.

## Goals / Non-Goals

**Goals:**

- `npm run tauri dev` opens a Learn Nodes window with the placeholder screen visible
- `npm run tauri build` produces a `.app` (and `.dmg`) bundle that, when launched, spawns the FastAPI sidecar and reaches `/health`
- Frontend reaches the backend via HTTP on localhost in dev and via Unix socket in production, behind a single `apiClient`
- Tailwind classes drive the placeholder styling — no custom CSS
- Existing Vitest, Playwright, and pytest suites stay green; one new Vitest test and one new Playwright spec land with the placeholder
- The phase 0 spec gets one added requirement pinning `npm run tauri dev` as the canonical end-to-end command

**Non-Goals:**

- Any real API surface beyond `/health` (CRUD, providers, chat, graph — all later phases)
- Router, navigation, multiple windows, deep links, code signing, notarization, auto-updater, tray, menubar — later phases
- Authentication, encryption, persistence — later phases
- Refactoring the existing scream/layered skeletons — they stay as Phase 0 left them
- Replacing the existing `/health` handler or moving it again

## Decisions

### Decision 1: Tauri supervises the backend only in production

**Choice:** When `npm run tauri dev` runs, Tauri connects to a backend already started by the developer (or by `npm run backend:dev`) on `http://127.0.0.1:8000`. When the bundled `.app` runs, Tauri uses `tauri-plugin-shell` to spawn the FastAPI sidecar binary on window startup and tears it down on window close.

**Rationale:** In dev, hot reload of both sides is more valuable than lifecycle automation — the developer wants uvicorn's `--reload` to restart Python without a Tauri restart, and the developer wants to attach a debugger to the Python process. The sidecar pattern would fight both of those. In production, the bundled user has no way to start a Python process separately, so Tauri must own the lifecycle.

```
dev:        Tauri window  ──HTTP──►  uvicorn (external, --reload)
production: Tauri window  ──HTTP/Unix──►  FastAPI sidecar (spawned by Tauri)
```

**Alternative considered:** Always spawn the sidecar from Tauri, even in dev. Rejected because it would block uvicorn's reload on every Python change.

### Decision 2: HTTP on localhost in dev, Unix socket in production

**Choice:** The `apiClient` chooses transport based on a build-time `import.meta.env.VITE_API_MODE` flag (`"http"` in dev, `"unix"` in production). HTTP always targets `http://127.0.0.1:8000` in dev. The Unix socket path is read from `import.meta.env.VITE_UNIX_SOCKET_PATH` (defaulting to a per-user temp path) in production.

**Rationale:** HTTP on localhost in dev is the path of least resistance — uvicorn already binds there, `curl` works for ad-hoc inspection, and CORS is straightforward. Unix socket in production avoids TCP port conflicts (the user's machine might already have something on 8000) and reduces surface area (no localhost listener). The flag-based choice lets the same client module serve both modes without runtime feature detection.

**Alternative considered:** Always HTTP, picking a random free port in production. Rejected because TCP port allocation in a desktop app is fragile (firewall prompts on first launch, port collisions on restart). Unix socket sidesteps both.

### Decision 3: `apiClient` is the only place that knows the transport

**Choice:** The frontend exposes a single `apiClient` module under `frontend/src/shared/lib/api-client.ts`. Every feature imports `apiClient.get("/...")` / `apiClient.post("/...", body)`; no feature constructs URLs or knows about `127.0.0.1` or socket paths. Every response is parsed through a Zod schema before being returned.

**Rationale:** Centralizing the transport keeps feature code uniform and keeps transport changes (a future WebSocket bridge, a future proxy through Tauri commands, etc.) confined to one file. Zod parsing at the edge means feature code receives typed, validated payloads and never has to handle a malformed JSON shape.

```
apiClient.get(path, { schema }) → Promise<z.infer<typeof schema>>
```

**Alternative considered:** Tauri commands (`@tauri-apps/api/core::invoke`) instead of HTTP. Rejected because Phase 0 already established HTTP as the transport of record in `tech-stack.md`, and Phase 4 streaming endpoints are SSE over HTTP — going through Tauri commands would force a different transport for streaming later.

### Decision 4: Placeholder is a single component, not a routed screen

**Choice:** `frontend/src/app/App.tsx` renders `<Placeholder />` directly. No `react-router-dom` route is added in this change; the placeholder is the entire app shell for Phase 1.

**Rationale:** A router is not warranted until there are at least two screens (Phase 3 brings the graph view, the node detail view, and the settings screen). Adding it now would create a router with one route — pure overhead.

**Alternative considered:** Add `react-router-dom` and put the placeholder at `/`. Rejected — keeps the dependency footprint smaller for Phase 1.

### Decision 5: Tailwind styling only, no design system yet

**Choice:** The placeholder uses Tailwind utility classes exclusively. No new `frontend/src/shared/components/` library is introduced. Colors come from Tailwind's default palette.

**Rationale:** A real design system (button, input, modal, theme tokens, dark mode) is Phase 14 work. Until then, raw Tailwind utilities are clearer than premature abstractions.

## Risks / Trade-offs

- **`npm run tauri dev` may fail silently on first run if Rust toolchain is not installed** → Mitigation: `package.json` already declares `@tauri-apps/cli`; the README in `src-tauri/` should be updated to point at the official Tauri prerequisites (Rust toolchain + Xcode CLT). The Playwright spec must not depend on a running Tauri build for CI — it runs against `vite dev` only.

- **CORS preflight failure when Vite serves at `:1420` and FastAPI at `:8000`** → Mitigation: `core/config.py` already adds CORS via `CORSMiddleware` with `allow_origins=["http://localhost:1420"]`. Confirm `127.0.0.1` is also on the allow-list during this change.

- **Sidecar binary mismatch between macOS architectures (Apple Silicon vs Intel)** → Mitigation: Phase 1 ships one sidecar binary per architecture. `tauri.conf.json` `bundle.targets` is `"all"`; the sidecar path is set under `bundle.externalBin` with the correct per-arch filename pattern. This is documented but not automated in Phase 1.

- **The window does not automatically reload when `frontend/dist/` changes during `tauri dev`** → Mitigation: Vite dev server (`devUrl`) handles HMR; only the production build reads `frontendDist`. The two paths never collide because `beforeDevCommand` and `beforeBuildCommand` are distinct.

- **Race between sidecar startup and first `/health` call from the placeholder** → Mitigation: The placeholder calls `/health` once on mount, no retries. If the sidecar is not ready, the indicator goes red; the user reloads the window. Phase 4 will add a `wait_for_health` Tauri command; Phase 1 keeps it simple.

- **`apiClient` Unix socket implementation in browser code is non-trivial** → Mitigation: Browsers cannot speak Unix sockets directly. In production, the bridge from the renderer to the sidecar MUST go through a Tauri command (e.g., `invoke("api_request", { path })`) that the Rust side implements over the Unix socket. Phase 1 establishes the client shape but uses HTTP-through-Tauri in production for simplicity; Phase 4 will swap in the Unix socket path on the Rust side. **Action item:** document this in `design.md` so Phase 4 knows where to plug in.

## Migration Plan

This change introduces new code; nothing existing is removed or replaced.

1. Land `tauri-app-shell` capability work — verify `npm run tauri dev` opens a window with a blank page.
2. Land `phase-one-placeholder-ui` — the window shows the placeholder, green dot when `/health` returns 200.
3. Land `fastapi-sidecar` — switch the placeholder to use `apiClient.get("/health", { schema: HealthSchema })`; verify HTTP in dev still works.
4. Land the `phase-zero-separation` delta requirement.
5. Run `npm test`, `npm run playwright`, `uv run pytest` — all green.

Rollback: every step is additive. If a step fails, revert the commit for that step and the previous state is restored.

## Open Questions

- **Where does the Unix socket actually live in production?** A per-user temp path (`/tmp/learn-nodes-<uid>.sock`) is fine for v1, but macOS sandboxing on distributed `.app` bundles may require the app data dir (`~/Library/Application Support/com.learnnodes.app/sidecar.sock`). Defer to Phase 4 once the sidecar is fully owned by Tauri.
- **Does Tauri 2's `tauri-plugin-shell` `Sidecar` API require a `tauri.conf.json` `bundle.externalBin` entry to find the binary?** Yes — the spec calls for that, but Phase 1 only needs HTTP in dev, so the entry is added but not exercised until Phase 4.
- **Should `VITE_API_MODE` default to `"http"` to keep `vite dev` solo work working?** Yes — `vite dev` runs without Tauri, so the build mode flag is meaningless there; default to `"http"` and only set `"unix"` in `tauri build`'s env.
