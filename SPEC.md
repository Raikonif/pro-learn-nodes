# SPEC.md — Phase 1: Project Skeleton

## What this phase delivers

A running Tauri 2 app with React frontend and FastAPI backend, communicating via HTTP on localhost. The app renders a placeholder screen. `npm run tauri dev` opens both processes and the window.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  DEV MACHINE                                          │
│                                                      │
│  ┌──────────────────┐      ┌──────────────────────┐ │
│  │  Tauri App       │      │  FastAPI Backend      │ │
│  │  (React + Vite)  │ HTTP │  (uv-managed)         │ │
│  │                  │─────▶│  localhost:8000        │ │
│  │  localhost:1420  │      │                       │ │
│  └──────────────────┘      └──────────────────────┘ │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Production (future)

FastAPI runs as a Tauri sidecar binary spawned by the Rust host process. IPC via Unix socket.

---

## Frontend (`/frontend`)

- **React 19** + **TypeScript** (strict)
- **Vite** — bundler / dev server (`vite.config.ts`)
- **Tailwind CSS** — configured with a minimal `globals.css` and `tailwind.config.js`
- **Tauri 2** — `@tauri-apps/api` for window management and IPC
- Vite dev server runs on `localhost:1420`
- API calls to `/api/*` proxied to `localhost:8000` via Vite proxy config

### Tauri config requirements

- `devtools: true` in `tauri.conf.json` for development
- `http://localhost` allowed as dev URL
- Window title: "Learn Nodes"
- Default size: 1200×800

---

## Backend (`/backend`)

- **Python 3.13+**
- **uv** — package manager, `pyproject.toml` + `uv.lock`
- **FastAPI** — `uvicorn` for serving
- **Pydantic v2** — for validation (needed even in Phase 1 for settings)

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{"status": "ok", "backend": "fastapi"}` |

### Dev command

```bash
cd backend && uv run uvicorn main:app --reload --port 8000
```

---

## Root package.json scripts

| Script | What it does |
|--------|-------------|
| `npm run tauri dev` | Starts Vite dev server + Tauri app (Tauri spawns FastAPI internally) |
| `npm run tauri build` | Builds the Tauri app (FastAPI bundled as sidecar in production) |
| `npm run backend:dev` | Runs FastAPI only (for debugging the API in isolation) |

---

## File inventory (Phase 1)

```
learn-nodes-personalized/
├── SPEC.md                          ← this file
├── package.json                     ← npm scripts + workspaces
├── frontend/
│   ├── package.json
│   ├── vite.config.ts               ← proxy /api → localhost:8000
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                 ← renders placeholder
│       └── styles/globals.css       ← Tailwind directives
├── backend/
│   ├── pyproject.toml
│   ├── uv.lock
│   └── main.py                     ← FastAPI app + /health
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        └── main.rs                 ← Tauri entry
```

---

## Acceptance criteria

1. `cd frontend && npm install && npm run dev` — Vite dev server starts on port 1420
2. `cd backend && uv sync && uv run uvicorn main:app --port 8000` — FastAPI starts, `GET /health` returns `200`
3. `npm run tauri dev` — Tauri window opens, shows "Learn Nodes" placeholder
4. Tauri window is making HTTP calls to FastAPI on localhost:8000
5. No TypeScript errors in `frontend/src/`
6. No Rust compilation errors in `src-tauri/`

---

## What is NOT in this phase

- No database
- No node data model
- No React Router
- No graph view
- No AI provider
- No skills or MCP
- No compaction
- No practice system

These all come in later phases.
