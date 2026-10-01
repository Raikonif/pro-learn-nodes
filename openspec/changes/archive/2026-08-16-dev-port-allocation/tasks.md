## 0. Preconditions

- [x] 0.1 Confirm `cd frontend && pnpm test` and `pnpm run typecheck`, and `cd backend && uv run pytest`, are all green before starting
- [x] 0.2 Record the current dev-loop behaviour for comparison: which ports are bound, and what `pnpm exec playwright test` does today

## 1. The allocator

- [x] 1.1 Add `scripts/dev-ports.mjs` exporting `DEFAULT_FRONTEND_PORT = 5177`, `DEFAULT_BACKEND_PORT = 8009`, `findFreePort(preferred, { limit })`, and `resolvePorts()`
- [x] 1.2 `findFreePort` scans upward from `preferred` using Node's `net` module, bounded by `limit` (default 100), and throws an error naming the range tried when exhausted
- [x] 1.3 `resolvePorts()` returns values from `LEARN_NODES_FRONTEND_PORT` / `LEARN_NODES_BACKEND_PORT` when both are set; otherwise allocates both, writes them back into `process.env`, and returns them
- [x] 1.4 Guarantee the two allocated ports never collide with each other
- [x] 1.5 Add `scripts/dev-ports.test.mjs`: defaults when free; next port when the default is occupied (bind a real socket); both defaults occupied; range exhausted throws naming the range; env values are returned unchanged without allocating
- [x] 1.6 Wire the allocator tests into a runnable command and confirm they pass
- [x] 1.7 Add `recordBackendPort()` / `discoverBackendPort()` implementing bind-vs-discover with `/health` verification (design.md Decisions 5 and 5a, added after implementation exposed the two-terminal flaw)
- [x] 1.8 Add discovery tests: a live backend is discovered; a stale record falls through to the default; an unrelated process holding the recorded port is rejected by health verification; no candidate verifies and the caller is warned rather than failed

## 2. Dev launcher

- [x] 2.1 Add `scripts/dev.mjs` that calls `resolvePorts()`, prints both ports, and marks any that differs from its default
- [x] 2.2 Have it exec `tauri dev` with a `--config` override setting `build.devUrl` to the allocated frontend origin
- [x] 2.3 Update the root `package.json`: `dev` runs the launcher; `backend` and `backend:dev` resolve the backend port instead of hardcoding `8000`
- [x] 2.4 Change `backend/sidecar.py`'s `--port` default from `8000` to `8009` so the standalone entry point matches the documented default

## 3. Vite — port and proxy

- [x] 3.1 Read the allocated frontend port from the environment in `frontend/vite.config.ts`, falling back to `5177`; keep `strictPort: true`
- [x] 3.2 Point the `/api` proxy target at the allocated backend origin, falling back to `8009`
- [x] 3.3 Add a `rewrite` stripping the `/api` prefix so the backend keeps serving its routes at their existing paths
- [x] 3.4 Verify by hand: `curl` the dev server's `/api/health` and confirm it returns the backend's `/health` payload

## 4. API client — same-origin in dev

- [x] 4.1 Replace `HTTP_BASE_URL` in `frontend/src/shared/lib/api-client.ts` with a relative `/api` prefix applied in the HTTP transport only
- [x] 4.2 Leave the Unix-socket transport untouched — the prefix and proxy have no part in production
- [x] 4.3 Update `api-client.test.ts` to assert the HTTP path requests `/api/health` for a caller passing `/health`
- [x] 4.4 Add a test asserting no caller-visible change: `apiClient.get('/health')` still resolves a valid payload

## 5. Backend — CORS

- [x] 5.1 Add a `port` setting to `backend/core/config.py` defaulting to `8009`
- [x] 5.2 Make `cors_origins` env-driven, defaulting to the allocated frontend origin on both `localhost` and `127.0.0.1`
- [x] 5.3 Set `allow_credentials=False` in `backend/main.py`
- [x] 5.4 Add `backend/tests/test_cors.py`: an allowed origin gets the permission header; a disallowed origin does not; no response advertises credentialed cross-origin access; the configured origins are never a wildcard
- [x] 5.5 Confirm `uv run pytest` stays green — `/health` and its route path are unchanged

## 6. Playwright

- [x] 6.1 Derive `baseURL` and both `webServer` entries in `frontend/playwright.config.ts` from `resolvePorts()`
- [x] 6.2 Set `reuseExistingServer: false` so the suite always owns its processes
- [x] 6.3 Pass the allocated backend port to the backend `webServer` command
- [x] 6.4 Run the suite with a decoy process bound to `8009` and confirm it allocates elsewhere, starts its own backend, and passes

- [x] 6.5 Trust an explicitly supplied `LEARN_NODES_BACKEND_PORT` without health verification. The spec makes supplied values authoritative and scopes verification to *recorded* candidates; verifying the supplied value too is why Playwright's webServer ordering became load-bearing
- [x] 6.6 Fix the leaked `uvicorn` grandchild in `scripts/backend.mjs`. Root cause was the `uv run` intermediary; the fix is a FLAT tree (spawn `.venv/bin/uvicorn` directly, falling back to `uv run` before `uv sync`) and staying in the parent's process group. A first attempt using `detached: true` made it worse — a separate group survives the group-wide kill a supervisor like Playwright sends. Verified: no orphan after a full Playwright run or a manual SIGTERM

## 7. Tauri

- [x] 7.1 `devUrl` in `src-tauri/tauri.conf.json` updated to the new default `5177` and left as a fallback. NOTE: `tauri.conf.json` is strict JSON and cannot carry a comment, so the override is documented in `CLAUDE.md` and the spec instead of in the file
- [x] 7.2 Confirm the `--config` override reaches the window. Verified adversarially: with 5177 squatted the launcher allocated 5178, making the committed `devUrl` both wrong AND pointing at a dead socket. The window still loaded and the app called `/health`, which is only possible if the override reached Tauri

## 8. Documentation

- [x] 8.1 Update `CLAUDE.md`: new default ports, the `pnpm dev` launcher, the `/api` proxy path, and the removal of the fixed-port constraint
- [x] 8.2 Update `openspec/tech-stack.md` where it describes the dev IPC contract
- [x] 8.3 Add the ports manifest path, if one is emitted, to `.gitignore`

## 9. Verify

- [x] 9.1 `cd frontend && pnpm test` green
- [x] 9.2 `cd frontend && pnpm run typecheck` clean
- [x] 9.3 `cd backend && uv run pytest` green
- [x] 9.4 `openspec validate dev-port-allocation --strict` passes
- [x] 9.5 Full dev loop with both defaults free: `pnpm dev` reported frontend 5177 / backend 8009 (verified, from recorded), the window opened (`windowDidBecomeKey`), and the backend logged 5 `GET /health` from the webview
- [x] 9.6 Full dev loop with `8009` occupied by a decoy: backend announced `port 8010 (default 8009 unavailable)`, Vite discovered it as `8010 (verified, from recorded)`, the window opened, and the webview got 4 × `GET /health` 200 on 8010 — the payload that makes the dot read online
- [x] 9.7 Re-run `node-workspace-ui` tasks 14.5 and 15.5, which were blocked on port contention

## 10. Out of scope — do not do

- [x] 10.1 Do NOT change any backend route path or the `/health` response contract
- [x] 10.2 Do NOT mount the backend router under an `/api` prefix — the proxy rewrite handles it
- [x] 10.3 Do NOT touch the Unix-socket production transport
- [x] 10.4 Do NOT introduce `allow_origin_regex` or a wildcard origin
- [x] 10.5 Do NOT bind anything to a non-loopback interface
- [x] 10.6 Do NOT add a dependency — Node's `net` module covers allocation
