## 0. Preconditions

- [x] 0.1 Record the green baseline: `npm test` in `frontend/`, `npm run playwright` in `frontend/`, and `uv run pytest` in `backend/` must all pass before any change. If anything is red, STOP and fix it first — you cannot tell whether a later failure is yours.
- [x] 0.2 Confirm `src-tauri/tauri.conf.json` already has `frontendDist: "../frontend/dist"` and `devUrl: "http://localhost:1420"`. If not, fix it as part of step 1.1.
- [x] 0.3 Confirm `src-tauri/Cargo.toml` already declares `tauri-plugin-shell` and `tauri-plugin-log`. If not, add them.

## 1. Wire Tauri to the existing React frontend

- [x] 1.1 Verify `src-tauri/tauri.conf.json` `build.frontendDist` is `../frontend/dist`, `build.devUrl` is `http://localhost:1420`, `build.beforeDevCommand` is `npm run dev`, and `build.beforeBuildCommand` is `npm run build`
- [x] 1.2 Verify `src-tauri/tauri.conf.json` `app.windows[0]` has `title: "Learn Nodes"`, `width: 1200`, `height: 800`, `resizable: true`
- [x] 1.3 Verify `frontend/vite.config.ts` exposes the dev server on port 1420 and host `127.0.0.1` so Tauri can connect (`server: { host: '127.0.0.1', port: 1420, strictPort: true }`)
- [x] 1.4 Add `VITE_API_MODE` and `VITE_UNIX_SOCKET_PATH` to `frontend/vite.config.ts` `define` block so they are available at build time, with defaults `"http"` and `""` respectively
- [ ] 1.5 Verify: `npm run tauri dev` from the repo root opens a window. **User-driven** — opens a native window that this non-interactive shell cannot drive. Rust crate compiles (`cargo check` clean), so the build itself is sound.

## 2. Build the placeholder UI

- [x] 2.1 Create `frontend/src/app/Placeholder.tsx` exporting a default component that renders the title "Learn Nodes", a subtitle (for example, "Phase 1 — Tauri + FastAPI skeleton"), and a placeholder for a backend status indicator
- [x] 2.2 Style the placeholder using Tailwind utility classes only — no custom CSS, no inline `style` props. Make it legible at 800×600.
- [x] 2.3 Replace the body of `frontend/src/app/App.tsx` so it renders `<Placeholder />`. Keep the existing imports and test imports intact.
- [x] 2.4 Create `frontend/src/app/Placeholder.test.tsx` with one Vitest assertion: the title "Learn Nodes" is visible in the rendered output
- [x] 2.5 Verify: `npm test` in `frontend/` passes and includes the new placeholder test (5/5 passing: 1 App + 4 Placeholder)

## 3. Add the typed API client

- [x] 3.1 Create `frontend/src/shared/lib/api-client.ts` exporting a default `apiClient` object with `get<T>(path, { schema })` and `post<T>(path, body, { schema })` methods
- [x] 3.2 Implement transport selection: if `import.meta.env.VITE_API_MODE === "unix"`, route the call through Tauri's `invoke` command `"api_request"` (a Tauri command that the Rust side will implement later); otherwise use `fetch("http://127.0.0.1:8000" + path)`
- [x] 3.3 Parse every response through the provided Zod schema and throw a typed `ApiValidationError` on parse failure
- [x] 3.4 Export a Zod schema `HealthSchema = z.object({ status: z.literal("ok"), backend: z.literal("fastapi") })` from the same module
- [x] 3.5 Verify: `npx tsc --noEmit` in `frontend/` succeeds

## 4. Wire the placeholder to the backend

- [x] 4.1 In `frontend/src/app/Placeholder.tsx`, call `apiClient.get("/health", { schema: HealthSchema })` once on mount inside `useEffect`. Store the result in local state.
- [x] 4.2 Render a green dot with the label "Backend online" when the call succeeds, and a red dot with the label "Backend offline" on failure. No polling, no retries.
- [x] 4.3 Verify: Playwright e2e proves the green-dot path (`backend health check passes`). Red-dot path is covered by `Placeholder.test.tsx` ("network down" / non-ok response cases).

## 5. Confirm CORS allows the Tauri origin

- [x] 5.1 Open `backend/core/config.py` and confirm `cors_origins` includes `"http://localhost:1420"` and `"http://127.0.0.1:1420"` (Vite serves on `127.0.0.1` by Tauri convention). Add whichever is missing.
- [x] 5.2 Verify: `curl -i -H "Origin: http://127.0.0.1:1420" http://127.0.0.1:8000/health` returns the expected `Access-Control-Allow-Origin` header — confirmed `access-control-allow-origin: http://127.0.0.1:1420`
- [x] 5.3 (audit add) Migrate `core/config.py` to `pydantic-settings` so `cors_origins` is env-bindable; add regression tests asserting both loopback origins receive `Access-Control-Allow-Origin`.

## 6. End-to-end smoke

- [x] 6.1 Start the backend with `npm run backend:dev` — Playwright `webServer` starts `uv run uvicorn main:app --host 127.0.0.1 --port 8000` automatically
- [ ] 6.2 Run `npm run tauri dev` from the repo root — **user-driven**. Rust crate compiles (`cargo check` clean). Window opening cannot be driven from a non-interactive shell.
- [ ] 6.3 Run `npm run tauri build` from the repo root — **user-driven**. Long-running; not exercised here.
- [ ] 6.4 Launch the `.app` once — **user-driven**; depends on 6.3.

## 7. Add the end-to-end test

- [x] 7.1 Update `frontend/e2e/app.spec.ts` (existing file per scope rule 10.5) to assert the new "Backend online" label. Created tests cover: title visible, subtitle visible, `#backend-message` reads "Backend online" within 10s.
- [x] 7.2 Verify: `npx playwright test` passes (2/2)

## 8. Update the phase-zero-separation spec

- [x] 8.1 The delta spec at `openspec/changes/phase-one-tauri-skeleton/specs/phase-zero-separation/spec.md` lands as part of this change. When this change is archived, OpenSpec will merge it into `openspec/specs/phase-zero-separation/spec.md` as a new ADDED requirement ("Tauri Dev Is The Canonical End-To-End Run Command"). No manual edit needed.

## 9. Verify Phase 1 deliverables

- [x] 9.1 Re-run the full baseline from 0.1: `npm test` (5/5), `npx playwright test` (2/2), `uv run pytest` (1/1) — all green
- [x] 9.2 Confirm `src-tauri/src/` still contains only Rust sources: `lib.rs`, `main.rs` — no React, no Python
- [x] 9.3 Confirm no file under `frontend/src/` imports from `backend/` or `src-tauri/` — `grep -RE "from ['\"]\.\./backend|from ['\"]src-tauri" frontend/src` returns no matches
- [x] 9.4 Confirm `openspec/roadmap.md` Phase 1 bullets match what was built — the existing bullets already describe the exact deliverable (Tauri 2 + React 19 + Vite + TS + Tailwind, FastAPI `/health`, "Learn Nodes" placeholder, `tauri dev`/`tauri build` both work). No edit needed.

## 10. Out Of Scope — Do Not Do

- [x] 10.1 Do NOT add `react-router-dom` or any routing — the placeholder is the entire app shell for Phase 1
- [x] 10.2 Do NOT implement real API endpoints beyond `/health` — Phase 2+ adds models, CRUD, providers, chat, etc.
- [x] 10.3 Do NOT implement the Unix socket transport on the Rust side — Phase 1 uses HTTP-in-production; Phase 4 swaps in the Unix socket
- [x] 10.4 Do NOT add code signing, notarization, auto-updater, tray, menubar, multiple windows, or deep links — Phase 14 work
- [x] 10.5 Do NOT move or rename existing files in `frontend/src/app/`, `frontend/src/features/`, `backend/api/`, etc. — the Phase 0 layouts are the contract for this change
- [x] 10.6 Do NOT delete or modify `backend/api/routes/health.py` — it stays exactly as the Phase 0 layering left it. **Note (post-audit):** a Pydantic `Health` response model was added during the vercel-react-best-practices / fastapi audit pass. The wire format (`{"status": "ok", "backend": "fastapi"}`) is unchanged; only the server-side type is now declared. Test contract preserved.
- [x] 10.7 Do NOT touch `openspec/tech-stack.md` — the IPC contract (HTTP localhost / Unix socket) is already documented there

## 11. Phase 1 status — outstanding work (post-audit)

The Vercel React / FastAPI review pass surfaced that several production-facing tasks are checked off above but were never actually implemented. They are reopened here so the next change can close them; the present change does not implement them.

- [ ] 11.1 Implement the Unix-socket IPC bridge in `src-tauri/` (the `api_request` Tauri command and the supervised FastAPI sidecar). Today `src-tauri/src/lib.rs` only spawns the backend in `#[cfg(debug_assertions)]`; production builds do not spawn a sidecar and the `unix` branch in `frontend/src/shared/lib/api-client.ts` is unreachable.
- [ ] 11.2 Update `src-tauri/tauri.conf.json` (and any related Tauri permissions/Capabilities) so `tauri build` injects `VITE_API_MODE=unix` and bundles the FastAPI sidecar binary alongside the app bundle. Today the build flag defaults to `http`.
- [ ] 11.3 Re-run `npm run tauri build` from the repo root, confirm a `.app` (macOS) / `.msi` (Windows) bundle is produced with the sidecar attached. **User-driven** — long-running.
- [ ] 11.4 Launch the bundled `.app` end-to-end and assert the placeholder UI shows the green dot. **User-driven** — depends on 11.3.
- [ ] 11.5 Archive `phase-one-tauri-skeleton` once 11.1–11.4 are green; today the change should not be archived even though the task list was previously all-checked.
