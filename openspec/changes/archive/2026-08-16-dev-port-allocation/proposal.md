## Why

Every port in the dev loop is hardcoded — `1420` for Vite, `8000` for FastAPI — in seven places across four config files and three specs. Ports 8000 and 1420 are among the most contended on a developer machine, and when one is already taken the failure is not a clean error. Playwright's `webServer` uses `reuseExistingServer`, so it silently attaches to whatever answers on port 8000 and reports a confusing assertion failure instead of a port conflict. This blocked a task in `node-workspace-ui` and cost real time diagnosing.

Moving to less-contended defaults is only half a fix; the other half is behaving sanely when even those are taken.

## What Changes

- Default dev ports become **5177** (frontend) and **8009** (backend). When a default is unavailable, the next free port is allocated automatically.
- Ports are allocated **once per dev session, before any process starts**, then injected into every consumer: uvicorn, Vite, the Tauri `devUrl`, and Playwright. Nothing discovers a port by guessing or by reading another process's output.
- **BREAKING**: The frontend reaches the backend through the Vite dev-server proxy under an `/api` prefix instead of calling `http://127.0.0.1:8000` directly. Dev traffic becomes same-origin, so the browser's CORS machinery is no longer involved in the standard dev loop. The proxy rewrites `/api/*` to `/*` on the way through, so backend routes and their tests are untouched.
- **BREAKING**: `allow_credentials` is turned off on the CORS middleware. Nothing in the app uses cookies — BYOK provider keys travel in headers — and leaving it on is what forbids any wildcard or pattern-based origin fallback.
- The backend's CORS allowlist is driven by environment rather than a hardcoded tuple, defaulting to the allocated frontend origins, so a developer who bypasses the proxy still works.
- Vite keeps `strictPort: true`. Allocation happens up front, so a port that is taken *after* allocation is a genuine fault and should fail loudly rather than silently move.
- Playwright stops reusing an existing server and always starts its own on allocated ports, removing the class of failure where the suite runs against an unrelated process.
- Production is untouched: bundled builds talk to the sidecar over a Unix socket, where ports and origins do not exist.

## Capabilities

### New Capabilities

- `dev-port-allocation`: Default ports, availability-based fallback, single-allocation-per-session, and injection into uvicorn, Vite, Tauri, and Playwright.
- `dev-api-proxy`: The frontend's dev-time path to the backend — `/api` prefix, proxy rewrite, same-origin guarantee, and what the API client may and may not construct.

### Modified Capabilities

- `fastapi-sidecar`: The dev HTTP transport requirement hardcodes `http://127.0.0.1:8000` and states "CORS SHALL allow the dev origin". Both change: the port is allocated, and dev traffic is same-origin through the proxy rather than CORS-permitted. The sidecar supervision requirement also hardcodes the same port.
- `tauri-app-shell`: `devUrl` is specified as the literal `http://localhost:1420`. It becomes the allocated frontend origin, supplied at launch.
- `phase-zero-separation`: The backend-runs-independently requirement pins `--port 8000` in both the command and its scenarios.
- `frontend-e2e-testing`: The Playwright requirement's scenario explicitly endorses attaching to an already-listening server, which is the behavior that produced the silent misattachment.

## Impact

| Area | Change |
|---|---|
| `scripts/dev-ports.mjs` *(new)* | Allocator: preferred-port-then-scan, env-first resolution, manifest emission |
| `scripts/dev.mjs` *(new)* | Dev launcher: resolves ports, then execs Tauri with a `devUrl` config override |
| `package.json` (root) | `dev`, `backend`, `backend:dev` scripts stop hardcoding ports |
| `frontend/vite.config.ts` | Port and proxy target read from env; `/api` proxy gains a rewrite and covers all backend routes |
| `frontend/playwright.config.ts` | `baseURL` and both `webServer` entries use allocated ports; `reuseExistingServer` disabled |
| `frontend/src/shared/lib/api-client.ts` | HTTP transport issues relative `/api/...` requests instead of an absolute origin |
| `backend/core/config.py` | `cors_origins` becomes env-driven; adds a `port` setting |
| `backend/main.py` | `allow_credentials=False` |
| `src-tauri/tauri.conf.json` | `devUrl` no longer authoritative; overridden at launch |

**Dependencies** — none. The allocator uses Node's `net` module; no new packages.

**Interaction with `node-workspace-ui`** — that change is 75/77 complete with two tasks blocked on port contention. Landing this first unblocks its Playwright task without requiring anything to be stopped by hand. Its two open tasks should be re-run afterward, since the ports they exercise will have moved. No artifact of that change contradicts this one: its call sites use `apiClient.get('/health', …)`, and only the client's internals change.

**Not addressed** — production port selection (the sidecar uses a Unix socket), remote or non-loopback binding, and any change to the `/health` contract itself.
