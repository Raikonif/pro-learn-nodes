## Context

Ports are hardcoded in seven places today:

```
package.json (root)      backend:dev / backend     → --port 8000
frontend/vite.config.ts  server.port               → 1420  (strictPort: true)
frontend/vite.config.ts  proxy['/api'].target      → http://localhost:8000
frontend/playwright.*    baseURL                   → http://localhost:1420
frontend/playwright.*    webServer[1].url          → http://127.0.0.1:8000/health
frontend/src/shared/lib/api-client.ts  HTTP_BASE_URL → http://127.0.0.1:8000
backend/core/config.py   cors_origins              → localhost:1420, 127.0.0.1:1420
src-tauri/tauri.conf.json  devUrl                  → http://localhost:1420
backend/sidecar.py       --port default            → 8000
```

Two of these are already inconsistent with each other. `vite.config.ts` declares a `/api` proxy that nothing uses, because `api-client.ts` calls the backend origin directly — which is the sole reason CORS is needed in dev at all. And the proxy would not have matched anyway: the only route is `/health`, not `/api/health`.

The failure that motivated this change was not a bind error. Playwright's `webServer` sets `reuseExistingServer: !process.env.CI`, so when an unrelated container held port 8000, Playwright treated it as "the backend is already up", started no server of its own, and ran the suite against it. `/health` returned that project's HTML, Zod validation failed, and the indicator read "Backend offline" — a passing product reported as a product bug.

## Goals / Non-Goals

**Goals:**

- Defaults of `5177` and `8009`, with automatic fallback when taken
- One allocation per dev session, resolved before any process starts, injected into every consumer
- Remove CORS from the normal dev path rather than making the allowlist dynamic
- A port collision produces a clear message naming the port, never a misleading assertion failure

**Non-Goals:**

- Production port selection — bundled builds use a Unix socket, where ports and origins do not exist
- Binding to anything other than loopback
- Changing the `/health` contract, the Zod schema, or any backend route path
- A general service-discovery mechanism; this covers exactly two processes

## Decisions

### 1. Remove the CORS surface instead of making it dynamic

The obvious reading of "dynamic ports" is "make the CORS allowlist dynamic too". That is the wrong layer to solve it at.

```
  TODAY — the browser crosses an origin boundary, so CORS is enforced
  browser ──▶ localhost:5177 (Vite)
     └──────▶ 127.0.0.1:8009 (FastAPI)     preflight · allowlist · breaks on port change

  PROXIED — the browser never leaves the Vite origin
  browser ──▶ localhost:5177 (Vite) ──▶ 127.0.0.1:8009 (FastAPI)
                                    └── server-side hop; no browser, no CORS
```

Once the browser only ever addresses the dev server, a moving **frontend** port cannot break CORS — traffic is same-origin by construction. A moving **backend** port only has to reach Vite's proxy target, which is Node configuration, not browser-enforced policy. The allowlist stops being a moving target because it stops being on the request path.

The allowlist is still made configurable, defaulting to the allocated frontend origin, so a developer who deliberately bypasses the proxy is not stranded. It is a fallback, not the mechanism.

Rejected: `allow_origin_regex` matching any loopback port. It is one line and it works, but it means any local process on any port can call the API — and this app holds BYOK provider keys. A dev-only regex also has to be reliably dev-only, which is a guarantee that tends to erode. Rejected: passing the allocated frontend origin into the backend as `CORS_ORIGINS` as the primary mechanism — workable, but it makes the backend's correctness depend on the launcher having told it the truth, and leaves a cross-origin request path in place for no benefit.

### 2. Prefix with `/api` and rewrite in transit

The frontend addresses `/api/health`; the proxy strips `/api` and forwards `/health`.

```
  browser          Vite dev server            FastAPI
  GET /api/health ──▶ rewrite → GET /health ──▶ 200 {"status":"ok",…}
```

The rewrite is what keeps this cheap. Mounting the backend's router under an `/api` prefix would have been the tidier long-term namespacing, but it changes the backend's public contract, its OpenAPI paths, `backend/tests/test_health.py`, and the sidecar's production URL — for zero benefit to this change. Rewriting in the proxy confines the prefix to the segment between browser and dev server, where it is purely a routing device.

Only `api-client.ts` applies the prefix. Callers keep passing `/health`, so no feature code learns about it.

### 3. Disable `allow_credentials`

`main.py` sets `allow_credentials=True`, but nothing in the app uses cookies — provider keys are BYOK and travel in headers. Leaving it on has one concrete cost: it is precisely what makes any wildcard or broad-pattern origin illegal in a browser, so it constrains a fallback that is otherwise available.

Turning it off is a **BREAKING** change in the sense that a future cookie-based session would have to turn it back on deliberately. That is the right default: a credentialed cross-origin channel should be opened on purpose, not inherited from scaffolding.

### 4. Allocate first, then pin — `strictPort` stays `true`

Allocation and fail-fast are not in tension; they compose.

```
  allocate 5177 (verified free) ─┬─▶ vite --port 5177  (strictPort: true)
                                 ├─▶ tauri --config devUrl
                                 └─▶ playwright baseURL
  allocate 8009 (verified free) ─┬─▶ uvicorn --port 8009
                                 └─▶ vite proxy target
```

The chicken-and-egg is real: `devUrl`, `baseURL`, and the proxy target all need the port *before* Vite picks one. Letting Vite auto-increment (`strictPort: false`) means the authoritative port is known only to Vite, after everything else has already been configured with a guess. So allocation happens up front, and `strictPort` stays `true` — allocation proved the port free, so a conflict at bind time is a race or a stale process and deserves to be loud.

There is an unavoidable TOCTOU window between "found free" and "bound". `strictPort: true` is what makes that window fail visibly instead of silently diverging.

### 5. Allocate what you bind; discover what you connect to

*Revised during implementation — the original decision was wrong, and building the launcher exposed it.*

The first version made every consumer call `resolvePorts()`, which scans for availability. That works only if all consumers share one parent process. The documented workflow does not:

```
  Terminal 1:  pnpm run backend:dev  → 8009 free → uvicorn binds 8009
  Terminal 2:  pnpm dev              → 8009 OCCUPIED (by our own backend)
                                     → allocates 8010 → proxy points at nothing
```

Availability scanning cannot distinguish "held by a foreign process" from "held by the server I need to talk to." They are opposite answers to the same observation. So the two roles are split:

| Role | Question | Mechanism |
|---|---|---|
| **Bind** | which port is free? | allocate by scanning, then record |
| **Connect** | where is it listening? | discover: supplied → recorded → default |

`backend:dev` binds, so it allocates. Vite binds the frontend port, so it allocates that — but it only *connects* to the backend, so it discovers it. Playwright starts both servers itself, so it allocates both.

### 5a. A recorded port is a candidate, not an answer

Decision 5 originally rejected a manifest because a stale file from a dead session is indistinguishable from a live one. That objection is correct and also answerable: **verify before trusting.** A candidate port is accepted only if it serves this application's health endpoint with the expected payload — which rejects both a dead record and an unrelated process squatting on the port. That second case is not hypothetical; it is precisely the failure that motivated this change.

Resolution order is supplied → recorded → default, each verified, and a consumer that exhausts all candidates warns naming what it tried rather than failing. Refusing to start would break frontend-only work with the backend deliberately stopped, which `phase-zero-separation` requires to keep working.

The environment remains the transport within a single process tree: `pnpm dev` → Tauri → `beforeDevCommand` → Vite all inherit. The record exists solely to bridge separate terminals.

### 6. Tauri's `devUrl` is overridden at launch

`tauri.conf.json` is plain JSON with no environment interpolation, so `devUrl` cannot reference an allocated port. The launcher passes `--config` with an inline override at run time. The committed value stays as a fallback for anyone invoking `tauri dev` directly, and the spec marks it non-authoritative so the two cannot silently disagree.

### 7. Playwright starts its own servers

`reuseExistingServer` becomes `false`. With allocation guaranteeing free ports, the reuse behavior has no upside left — its only effect is the failure mode that prompted this change. The suite now always owns its processes, so anything listening on a chosen port is by definition unrelated and is never attached to.

## Risks

- **TOCTOU on allocation.** A port verified free can be taken microseconds later. Mitigated by `strictPort` and by binding immediately after allocating; accepted rather than solved, since eliminating it requires holding the socket open across the handoff.
- **Proxy behavior drift.** Dev now goes through a hop that production does not have. Streaming (SSE, Phase 4+) must be verified through the proxy, since a misconfigured proxy can buffer event streams. Flagged here so the phase that adds SSE tests it explicitly rather than discovering it late.
- **Two transports, one client.** The HTTP path gains a prefix the Unix-socket path does not use. Contained inside `api-client.ts`, but it is a second place where the two modes diverge.
