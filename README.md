# Learn Nodes

> Sessions, not chats. A graph, not a list. Corrections that compound. Context that outlives any single conversation.

A local-first, open-source learning environment for macOS where **conversational sessions form a navigable graph**. Every conversation is a node; every node is a session. You branch new sessions from any turn of any conversation, correct the agent and choose what propagates downstream, and practice with exercises the agent authors from your own material.

Built as a [Tauri 2](https://v2.tauri.app/) desktop app: React frontend, FastAPI backend, SQLite storage, BYOK (bring your own API keys).

**Status:** early development — Phase 1 (Project Skeleton) of a 15-phase roadmap. The app shell, backend health endpoint, and test/CI harness are in place. See [`openspec/roadmap.md`](openspec/roadmap.md) for what's coming.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [Project Structure](#project-structure)
- [Scripts Reference](#scripts-reference)
- [Testing](#testing)
- [Development Conventions](#development-conventions)
- [Roadmap](#roadmap)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  DEV MACHINE                                             │
│                                                          │
│  ┌────────────────────┐        ┌──────────────────────┐  │
│  │  Tauri App         │  HTTP  │  FastAPI Backend     │  │
│  │  (Rust + WebView)  │───────▶│  (uv-managed)        │  │
│  │  React + Vite      │        │  localhost:8000      │  │
│  │  localhost:1420    │        │                      │  │
│  └────────────────────┘        └──────────┬───────────┘  │
│                                           │              │
│                                     ┌─────▼─────┐        │
│                                     │  SQLite   │        │
│                                     │ (planned) │        │
│                                     └───────────┘        │
└──────────────────────────────────────────────────────────┘
```

- **Dev:** Vite proxies `/api/*` → `http://localhost:8000`; the FastAPI process runs standalone.
- **Production (planned):** FastAPI ships as a Tauri sidecar binary spawned by the Rust host, communicating over a Unix socket.

---

## Tech Stack

### App shell

| Tool | Version | Why |
|---|---|---|
| **Tauri 2** | `2.11.x` | ~10× smaller bundle than Electron, native macOS feel, fast cold start |
| **Rust** | `>= 1.77.2` | Tauri host process |

### Frontend (`frontend/`)

| Tool | Version | Role |
|---|---|---|
| **React** | `19` | UI |
| **TypeScript** | `5.7` (strict) | Types |
| **Vite** | `6` | Bundler + dev server (port `1420`) |
| **Tailwind CSS** | `3.4` | Styling |
| **Zod** | `3` | Runtime schema validation for API payloads and forms |
| **Vitest** + **Testing Library** | `3` / `16` | Unit + component tests |
| **Playwright** | `1.62` | End-to-end tests |

*Planned (later phases):* Zustand (state), React Router, react-force-graph (spatial canvas), TipTap (rich text), Shiki (syntax highlighting), Pyodide (in-browser code sandbox).

### Backend (`backend/`)

| Tool | Version | Role |
|---|---|---|
| **Python** | `>= 3.13` | Runtime |
| **uv** | latest | Package manager (lockfile-driven) |
| **FastAPI** | `>= 0.140` | Async HTTP API |
| **Uvicorn** | `>= 0.51` | ASGI server |
| **Pydantic v2** | `>= 2.13` | Validation, settings, serialization |
| **SQLModel** | `>= 0.0.22` | ORM — one model = DB row + API schema |
| **Alembic** | `>= 1.15` | Migrations |
| **pytest** (+ `pytest-asyncio`, `httpx`) | `>= 8.3` | Tests |

*Planned:* SQLite with FTS5 full-text search, SSE streaming, pluggable AI provider adapters (Anthropic / OpenAI / OpenRouter / Ollama), MCP client, PyMuPDF file extraction.

### Storage (planned)

SQLite single-file database, local-first. Node bodies stored as Markdown with YAML frontmatter; structure (`parent_id`, `fork_point`, `mode`) in SQL columns; FTS5 for search.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **macOS** | Primary target. Linux/Windows are possible via Tauri but untested. |
| **Node.js 20+** and npm | CI pins Node 20. |
| **Python 3.13+** | Pinned in `backend/.python-version`. |
| **[uv](https://docs.astral.sh/uv/)** | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Rust 1.77.2+** | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Xcode Command Line Tools** | `xcode-select --install` — required to build the Tauri host. |

Check your setup:

```bash
node --version    # v20+
python3 --version # 3.13+
uv --version
rustc --version   # 1.77.2+
```

---

## Installation

```bash
git clone <your-fork-or-repo-url> learn-nodes-personalized
cd learn-nodes-personalized

# 1. Root tooling (Tauri CLI)
npm install

# 2. Frontend dependencies
cd frontend && npm install && cd ..

# 3. Backend dependencies (creates backend/.venv from uv.lock)
cd backend && uv sync --extra test && cd ..
```

Rust dependencies are fetched automatically on the first `tauri dev` / `tauri build` (the initial compile takes a few minutes).

---

## Running the App

The backend and the Tauri window are separate processes during development. Run each in its own terminal.

**Terminal 1 — backend**

```bash
npm run backend:dev          # uvicorn on http://localhost:8000, with --reload
```

Verify: `curl http://localhost:8000/health` → `{"status":"ok","backend":"fastapi"}`

**Terminal 2 — desktop app**

```bash
cd frontend && npm run dev   # Vite dev server on http://localhost:1420
```

```bash
# then, from the repo root, in a third terminal:
npx tauri dev                # opens the "Learn Nodes" window (1200×800)
```

### Browser-only frontend

You don't need the Tauri window to iterate on UI:

```bash
npm run backend:dev                 # terminal 1
cd frontend && npm run dev          # terminal 2 → open http://localhost:1420
```

### Production build

```bash
cd frontend && npm run build && cd ..   # type-check + bundle into frontend/dist
npx tauri build                          # produces .app / .dmg under src-tauri/target/release/bundle/
```

> Bundling FastAPI as a Tauri sidecar is not wired up yet — a built app still expects the backend on `localhost:8000`. Sidecar packaging, code signing, and notarization land in Phase 14.

---

## Project Structure

```
learn-nodes-personalized/
├── package.json              ← root scripts (Tauri CLI + backend shortcuts)
├── SPEC.md                   ← Phase 1 specification
│
├── frontend/                 ← React app (runs independently of the backend)
│   ├── src/
│   │   ├── App.tsx           ← placeholder home screen
│   │   ├── main.tsx          ← React entry point
│   │   ├── styles/globals.css
│   │   └── setup-vitest.ts
│   ├── e2e/                  ← Playwright specs
│   ├── vite.config.ts        ← dev server + /api → :8000 proxy
│   ├── vitest.config.ts
│   ├── playwright.config.ts
│   └── tailwind.config.js
│
├── backend/                  ← FastAPI app (runs independently of the frontend)
│   ├── main.py               ← app + CORS + GET /health
│   ├── tests/                ← pytest suite
│   ├── pyproject.toml
│   └── uv.lock
│
├── src-tauri/                ← Rust host — Tauri config only, no React source
│   ├── src/{main.rs,lib.rs}
│   ├── tauri.conf.json
│   ├── capabilities/
│   └── Cargo.toml
│
├── openspec/                 ← spec-driven development workspace
│   ├── mission.md            ← what the product is and why
│   ├── tech-stack.md         ← full technology decisions + rationale
│   ├── roadmap.md            ← 15 phases, each independently shippable
│   ├── specs/                ← accepted specs
│   └── changes/              ← in-flight change proposals
│
└── .github/workflows/test.yml ← CI: frontend + backend test jobs
```

Target layouts as features land (see [`openspec/tech-stack.md`](openspec/tech-stack.md)):

- **Frontend — Scream Architecture:** organized by what the app *does*. `src/features/<graph-navigation|node-chat|study-launcher|settings|practice>/` (each with `components/`, `hooks/`, `types/`, `index.ts`), plus `src/shared/` and `src/app/`.
- **Backend — Layered Architecture:** `api/` → `service/` → `repository/` → `models/`, with `core/` for config, database, and exceptions.

---

## Scripts Reference

### Root

| Script | What it does |
|---|---|
| `npm run backend:dev` | FastAPI on port 8000 with auto-reload |
| `npm run backend` | FastAPI on port 8000, no reload |
| `npm run tauri <cmd>` | Passthrough to the Tauri CLI (`dev`, `build`, `info`, …) |

### Frontend (`cd frontend`)

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on `http://localhost:1420` |
| `npm run build` | `tsc` type-check, then production bundle → `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint — script is declared, but ESLint isn't installed or configured yet |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run playwright:install` | Install the Chromium browser for E2E |
| `npx playwright test` | Run E2E specs (auto-starts the Vite server) |

### Backend (`cd backend`)

| Command | What it does |
|---|---|
| `uv sync --extra test` | Install runtime + test dependencies |
| `uv run uvicorn main:app --reload --port 8000` | Run the API |
| `uv run pytest` | Run the test suite |

---

## Testing

| Layer | Tool | Location | Command |
|---|---|---|---|
| Frontend unit / component | Vitest + Testing Library (jsdom) | `frontend/src/**/*.test.tsx` | `cd frontend && npm test` |
| Frontend end-to-end | Playwright (Chromium) | `frontend/e2e/` | `cd frontend && npx playwright test` |
| Backend | pytest (asyncio auto mode, httpx) | `backend/tests/` | `cd backend && uv run pytest` |

E2E tests boot the Vite dev server automatically. The backend health-check spec expects `npm run backend:dev` to be running.

**CI** ([`.github/workflows/test.yml`](.github/workflows/test.yml)) runs on every pull request and every push to `main`, with two parallel jobs: frontend (unit + E2E) and backend (pytest).

---

## Development Conventions

- **Spec-driven.** Work is proposed and tracked in `openspec/changes/<change-name>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`) before implementation, then synced into `openspec/specs/` and archived.
- **Test-driven.** See `openspec/changes/test-driven-development/` — tests are written alongside (or before) the behavior they cover, and CI gates every PR.
- **Independent halves.** `frontend/` and `backend/` build, run, and test without each other. `src-tauri/` holds Rust/Tauri config only — no React source mixed in.
- **Public surfaces.** Frontend features export through `index.ts`; other features import the public surface, never internal paths.
- **Layer discipline.** Backend calls flow `api → service → repository → models`. An `api` module reaching straight into `repository` is a layer violation.
- **Types everywhere.** TypeScript strict on the frontend; Pydantic v2 / SQLModel on the backend; Zod at the API boundary in the browser.

---

## Roadmap

| Phase | Delivers |
|---|---|
| 0 | Frontend/backend structural separation |
| **1** | **Tauri window + FastAPI, talking to each other ← you are here** |
| 2 | Data model (`Node`, `ChatMessage`, `Correction`, …) + Alembic migrations |
| 3 | Node CRUD, file upload (PDF/image), graph view (canvas / outline / timeline) |
| 4 | Pluggable AI provider layer + BYOK key storage (encrypted, macOS Keychain) |
| 5 | Skills system — markdown skills loaded at inference time |
| 6 | MCP foundation — user-configured external tools |
| 7 | Node chat — every node is a living conversation, streamed over SSE |
| 8 | Branching + inheritance + fork points |
| 9 | Corrections + explicit propagation to children |
| 10 | Hierarchical compaction (turn → topic → node), every step drillable |
| 11 | Persistent cross-node memory |
| 12 | Self-authoring practice (code sandbox, Q&A, quiz) |
| 13 | Study launcher + mode orchestrator |
| 14 | Polish + `.dmg` distribution |
| 15 | Open ecosystem — CLI companion, authoring guides, plugin registry |

Full detail, per-phase demos, and deferred items: [`openspec/roadmap.md`](openspec/roadmap.md).

---

## Troubleshooting

**Port 1420 or 8000 already in use**

```bash
lsof -ti:1420 | xargs kill    # Vite
lsof -ti:8000 | xargs kill    # FastAPI
```

**`npm run dev` / `npm run tauri dev` from the repo root loops or hangs**

`src-tauri/tauri.conf.json` sets `beforeDevCommand: "npm run dev"`, which Tauri runs from the repo root — where `dev` is itself `tauri dev`. Start the Vite server yourself (`cd frontend && npm run dev`) and then run `npx tauri dev`, or pin the working directory in the config:

```jsonc
"beforeDevCommand": { "script": "npm run dev", "cwd": "frontend" },
"beforeBuildCommand": { "script": "npm run build", "cwd": "frontend" }
```

**Backend status shows "checking..." forever**

The backend isn't running or CORS is blocking the request. `main.py` only allows the origin `http://localhost:1420` — if Vite fell back to another port (`strictPort: false`), either free port 1420 or add your port to `allow_origins`.

**`uv sync` fails on the Python version**

Install 3.13 with `uv python install 3.13`; `backend/.python-version` pins it.

**Rust build errors on first run**

Ensure `xcode-select --install` has completed and your toolchain is current (`rustup update`).

---

## Documentation

| File | Contents |
|---|---|
| [`openspec/mission.md`](openspec/mission.md) | What the product is, core principles, anti-goals, data model |
| [`openspec/tech-stack.md`](openspec/tech-stack.md) | Every technology choice with rationale, plus target architectures |
| [`openspec/roadmap.md`](openspec/roadmap.md) | 15 phases with acceptance demos and dependencies |
| [`SPEC.md`](SPEC.md) | Phase 1 specification and acceptance criteria |

---

## License

Not yet specified. The project is intended to be open source — see `openspec/mission.md` ("Yours Forever", "Open Ecosystem").
