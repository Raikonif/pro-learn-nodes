# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**Learn Nodes** is a local-first macOS desktop app (Tauri 2) for learning via a navigable conversation graph. Sessions form nodes; nodes branch from any turn; corrections propagate to children. Built with React + FastAPI, BYOK AI keys, and SQLite storage. Currently at Phase 1 of a 15-phase roadmap (app shell + health endpoint only).

## Dev setup

Install all three dependency trees before running anything:

```bash
pnpm install                           # root (Tauri CLI)
cd frontend && pnpm install && cd ..   # frontend
cd backend && uv sync --extra test && cd ..  # backend
```

## Running in development

One command starts everything:

```bash
pnpm run all:dev              # backend, then — once /health answers — the Tauri window
```

The wait is load-bearing, not politeness. `pnpm dev` resolves the backend by
verifying its `/health` payload, so a check made before the backend answers
resolves as *absent* and you get a window that renders, reaches nothing, and
explains none of it. `all:dev` allocates both ports once, starts the backend,
waits for a verified health response, and only then starts the Tauri side.

The per-process commands are unchanged, for working on one side alone:

```bash
# Terminal 1 — backend
pnpm run backend:dev          # FastAPI on 8009 with --reload

# Terminal 2 — Tauri window (auto-starts Vite via beforeDevCommand)
pnpm dev                      # allocates the frontend port, then opens the window

# Frontend only, no Tauri window
cd frontend && pnpm run dev   # Vite on 5177
```

Verify backend: `curl http://127.0.0.1:8009/health` → `{"status":"ok","backend":"fastapi"}`

### Ports are allocated, not hardcoded

Defaults are **5177** (frontend) and **8009** (backend). If a default is taken, the next free port is used automatically and printed at startup — so a busy machine never produces a confusing failure.

The rule that keeps the two terminals in agreement: **a process allocates the port it binds and discovers the ports it only connects to.**

```
backend:dev   BINDS backend    → scans for a free port, records it in .dev-ports.json
pnpm dev      BINDS frontend   → scans for a free port
              REACHES backend  → reads the record, verifies /health, else falls back to 8009
playwright    BINDS both       → allocates both, never attaches to a server it didn't start
```

Scanning for the backend would be wrong: a running backend's port reads as "occupied", indistinguishable from a foreign process, so a scanning consumer would skip past it. Discovery verifies the `/health` payload before trusting a port, which also rejects an unrelated service squatting on it.

Override either port explicitly with `LEARN_NODES_FRONTEND_PORT` / `LEARN_NODES_BACKEND_PORT`; a supplied value is always authoritative.

`strictPort: true` stays on in Vite. Allocation already proved the port free, so a conflict at bind time is a race or a stale process and should fail loudly rather than move somewhere nothing else knows to look.

`tauri.conf.json:devUrl` cannot interpolate an env var, so `scripts/dev.mjs` injects the allocated origin with a `--config` override at launch. The committed `devUrl` is only a fallback for running `tauri dev` directly.

### Sign-in always works; `LEARN_NODES_DEV_AUTH` is only for Playwright

Sign-in is required to reach the workspace, and a **local** mechanism is registered unconditionally — no environment variable, no network, no external service. A fresh install opens on a picker of the accounts already on the device plus a way to create one, so `pnpm run all:dev` reaches the workspace with nothing else set.

Creating a local profile mints a **random** subject, deliberately unlike the development adapter, which derives a stable one from the request. So two profiles created with the same name are two accounts with two graphs; you return to one by selecting it in the picker, never by re-typing its name.

`LEARN_NODES_DEV_AUTH=1` adds the development mechanism beside it:

```bash
LEARN_NODES_DEV_AUTH=1 pnpm run backend:dev
```

Without it, `POST /auth/dev/signin` answers **404** — the same answer as an endpoint that was never written, so a distributed build does not advertise it. `POST /auth/local/signin` is present either way. The flag reads **only** from the process environment: a `.env` file cannot open it, because `Settings` re-checks `os.environ` after binding. Enabling it logs a warning at startup.

The E2E suite opens the gate for the backend it starts, and needs it: the development adapter's subject is derived from the requested name, so signing in twice as "Ada" returns the same account — which is what specs asserting that a graph survives an account switch depend on. Local sign-in cannot serve that purpose, by design.

`GET /auth/session` reports the registered mechanisms as a list, so the client offers only controls that can be completed.

### The frontend talks to the backend through the Vite proxy

`apiClient` issues **relative** `/api/...` requests to the Vite dev server, which strips the `/api` prefix and forwards to the backend. Dev traffic is therefore same-origin and CORS is not exercised at all — that is why a moving frontend port cannot break it. Backend routes are unchanged; the prefix exists only between the browser and the dev server.

The backend's CORS allowlist survives as a fallback for bypassing the proxy deliberately. It is env-driven (`LEARN_NODES_CORS_ORIGINS`), never a wildcard, and `allow_credentials` is off — nothing uses cookies, and enabling it is what would forbid any pattern-based origin.

## Commands

### Testing

```bash
# Backend
cd backend && uv run pytest                       # full suite
cd backend && uv run pytest tests/test_health.py  # single file
cd backend && uv run pytest -k "test_name"         # single test by name

# Frontend unit tests
cd frontend && pnpm test                # Vitest, single run
cd frontend && pnpm run test:watch      # Vitest, watch mode

# Frontend E2E (requires backend running)
cd frontend && pnpm exec playwright test
cd frontend && pnpm run playwright:install  # first time only (installs Chromium)
```

### Type checking and build

```bash
cd frontend && pnpm run typecheck       # tsc --noEmit
cd frontend && pnpm run build           # tsc + vite build → frontend/dist/
pnpm tauri build                        # full desktop bundle → src-tauri/target/release/bundle/
```

## Architecture

### Process topology

```
Tauri (Rust host)  ←→  WebView (React/Vite :5177)  →  /api/* proxy  →  FastAPI (:8009)
```

Vite proxies all `/api/*` requests to the backend and strips the prefix on the way through (`vite.config.ts`), so the browser stays same-origin and CORS is not on the request path. Both ports are allocated at startup — see "Ports are allocated, not hardcoded" above.

In production builds, FastAPI ships as a Tauri sidecar binary (`src-tauri/binaries/learn-nodes-backend-*`) and communicates over a Unix socket. Vite sets `VITE_API_MODE=unix` at build time (`beforeBuildCommand` in `tauri.conf.json`).

### Requests are scoped by the active account, never by the caller

Workspace routes do **not** accept a `workspaceId`. The scope is resolved server-side from the active account by the dependency in `api/dependencies/auth.py`, which is the only exported way to obtain one — a route that asks the client which workspace it wants is a defect, not a shortcut.

Services still receive a `workspace_id`; it simply no longer originates with the client. A request naming a workspace the active account does not own is refused **identically** to one naming a workspace that does not exist, so the response reveals nothing about what exists.

`/auth/*` is the deliberate exception: those routes must be reachable while signed out, or there would be no way to sign in. `GET /auth/session` never answers 401 — it is the route that *reports* being signed out.

### Backend — Layered Architecture

Calls must flow strictly in one direction: `api → service → repository → models`. Jumping from `api` directly into `repository` is a layer violation.

```
backend/
├── main.py           ← app construction, middleware, router mounting only
├── api/              ← PRESENTATION: FastAPI routers, dependencies, request/response schemas
├── service/          ← BUSINESS LOGIC: orchestration, branching, streaming context assembly
├── repository/       ← DATA ACCESS: SQLModel queries
├── models/           ← DOMAIN / DB: SQLModel classes (one model = DB row + API schema)
└── core/             ← SHARED: config.py (Pydantic BaseSettings), database.py, exceptions.py
```

Settings come from env vars or `backend/.env` via `core/config.py:settings` (a frozen singleton).

### Frontend — Scream Architecture

Code is organized by what the app *does*. Feature directories name the capability.

```
frontend/src/
├── features/
│   ├── graph-navigation/   ← spatial canvas, outline tree, timeline view
│   ├── node-chat/          ← per-node chat panel, SSE streaming
│   ├── study-launcher/     ← main entry point (topic + mode + file)
│   ├── settings/           ← provider keys, skills, MCP configuration
│   └── practice/           ← code sandbox, Q&A, quiz
├── shared/                 ← cross-feature: generic components, hooks, lib
└── app/                    ← routing and entry point only
```

Features export through `index.ts`. Other features import from the public surface only, never from internal paths.

### Key data model (planned, Phase 2+)

`Node` is the central entity: each node has a `parent_id` (nullable) and `fork_point` (which turn in the parent chat it branched from). This forms a DAG where a node can appear as a child of multiple parents. Conversation messages, file attachments, corrections, practice attempts, and compaction steps all link back to a `Node`.

### Spec-driven workflow

New features are proposed and tracked in `openspec/changes/<change-name>/` (proposal → design → tasks → specs) before implementation. Accepted specs are synced into `openspec/specs/` and changes archived. Consult `openspec/roadmap.md` for the full 15-phase plan and phase dependencies.

### Practice code runs in the WebView, never in the backend

The code sandbox executes the learner's Python in the frontend, in a WASM interpreter inside a dedicated Web Worker. It never runs in the FastAPI sidecar: that process holds the database and the learner's whole graph, and executing code there would be arbitrary code execution against their own data. Stopping a run, and the time limit, terminate the worker; the next run gets a fresh interpreter.

The interpreter is **vendored** into the app and loaded from the bundle the first time the sandbox is used. It is never fetched from a CDN: the sandbox must work offline, and a run must make no request to any host outside the application.

### Practice attempts are append-only

Answering a practice question always inserts a new attempt; nothing updates or removes one, and no route offers to. The item carries no "current answer" — the newest attempt is the latest row. Authoring by hand is the first producer of practice items; roadmap Phase 12 (and agents, through `agent-shared-context-mcp`) add further producers that write the same item rows through `service/practice_service.py`, not a parallel system.

## Key constraints

- **pnpm, not npm.** `ignore-scripts=true` in `.npmrc` — do not bypass this with `npm install`.
- **Python 3.13+** pinned in `backend/.python-version`. Use `uv python install 3.13` if missing.
- **strictPort: true** on Vite — but the port is allocated before Vite starts, so a conflict at bind time means a race or a stale process, and failing fast is the point.
- Backend test fixture (`conftest.py`) uses `httpx.AsyncClient` with `ASGITransport` — tests do not start a real server.
