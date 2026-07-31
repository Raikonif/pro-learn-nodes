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

Three separate processes. Each in its own terminal:

```bash
# Terminal 1 — backend
pnpm run backend:dev          # FastAPI on http://localhost:8000 with --reload

# Terminal 2 — frontend only (no Tauri window)
cd frontend && pnpm run dev   # Vite on http://localhost:1420

# Terminal 3 — Tauri window (starts after Vite is up)
pnpm tauri dev                # opens desktop window; auto-starts Vite via beforeDevCommand
```

`pnpm tauri dev` already invokes Vite via `tauri.conf.json:beforeDevCommand`, so Terminal 2 is only needed when iterating on UI without the Tauri shell.

Verify backend: `curl http://localhost:8000/health` → `{"status":"ok","backend":"fastapi"}`

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
Tauri (Rust host)  ←→  WebView (React/Vite :1420)  →  /api/* proxy  →  FastAPI (:8000)
```

Vite proxies all `/api/*` requests to `http://localhost:8000` (`vite.config.ts`). The FastAPI CORS allowlist is `localhost:1420` and `127.0.0.1:1420` only — if Vite moves to a different port, add it to `core/config.py:settings.cors_origins`.

In production builds, FastAPI ships as a Tauri sidecar binary (`src-tauri/binaries/learn-nodes-backend-*`) and communicates over a Unix socket. Vite sets `VITE_API_MODE=unix` at build time (`beforeBuildCommand` in `tauri.conf.json`).

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

## Key constraints

- **pnpm, not npm.** `ignore-scripts=true` in `.npmrc` — do not bypass this with `npm install`.
- **Python 3.13+** pinned in `backend/.python-version`. Use `uv python install 3.13` if missing.
- **strictPort: true** on Vite — port 1420 must be free or Vite fails fast.
- Backend test fixture (`conftest.py`) uses `httpx.AsyncClient` with `ASGITransport` — tests do not start a real server.
