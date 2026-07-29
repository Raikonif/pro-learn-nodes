## Context

The project is in early phases (Phase 1 of 15 planned). The repo-root split has already landed: `frontend/` (React/Vite, own `package.json`) and `backend/` (FastAPI, own `pyproject.toml`, uv-managed) exist as siblings alongside `src-tauri/` and `openspec/`. What has *not* landed is any internal organization within either.

Today `frontend/src/` contains `App.tsx`, `main.tsx`, `App.test.tsx`, `setup-vitest.ts`, `vite-env.d.ts`, and `styles/` — all flat. `backend/` contains a single `main.py` defining the FastAPI app and a `/health` route inline, plus `tests/`. As the project grows to include graph navigation, AI providers, skills, MCP integrations, and practice systems, organizing code by "what it does" rather than "what technology it uses" is essential.

Key constraints:
- Tauri 2 is the app shell — `src-tauri/` is the Tauri project root and holds **only** Rust (`src-tauri/src/lib.rs`, `src-tauri/src/main.rs`) plus config. No React source lives there.
- FastAPI runs as a sidecar, started alongside the Tauri app
- Frontend uses React 19 + TypeScript + Vite + Tailwind CSS
- Backend uses Python 3.13+ with FastAPI, SQLModel, Pydantic v2, Alembic — dependencies managed by `uv`
- A completed `test-driven-development` change means Vitest, Playwright, and pytest suites exist and are expected to stay green

## Goals / Non-Goals

**Goals:**
- Adopt scream architecture for frontend: feature-first folder structure under `frontend/src/`
- Adopt layered architecture for backend: `api/`, `service/`, `repository/`, `models/`, `core/` under `backend/`
- Preserve the existing test suites — every move updates its importers in the same step
- Correct the Phase 0 backend run command in `roadmap.md`, which currently contradicts itself

**Non-Goals:**
- Creating `frontend/` and `backend/` — already done
- Updating `tech-stack.md` — it already documents both patterns
- Migrating any existing feature code beyond moving `App.tsx` into `app/`
- Changing any technology choices (React, FastAPI, SQLite, etc.)
- Implementing any new capabilities — this is purely organizational

## Decisions

### Decision 1: Feature-First Folder Structure for Frontend

**Choice:** `frontend/src/features/` as the primary organizing unit, with `shared/` for cross-cutting code and `app/` for routing/app shell.

**Rationale:** Scream architecture means the folder names tell you what the app does. A developer opening `features/graph-navigation/` immediately understands that part of the app handles graph visualization. Grouping by technology (`components/`, `hooks/`, `lib/`) hides what the app actually does.

```
frontend/src/
├── features/
│   ├── graph-navigation/
│   │   ├── components/     ← SpatialCanvas, OutlineTree, TimelineView
│   │   ├── hooks/          ← useGraphData, useNodeSelection
│   │   ├── types/          ← GraphViewMode, NodePosition
│   │   └── index.ts        ← public API surface
│   ├── node-chat/
│   ├── study-launcher/
│   ├── settings/
│   └── practice/
├── shared/
│   ├── components/         ← Button, Input, Modal (generic)
│   ├── hooks/               ← useLocalStorage, useDebounce
│   └── lib/                 ← markdown parser, FTS helpers
└── app/
    ├── routes/              ← /, /node/:id, /settings
    └── App.tsx
```

**Alternative considered:** Hybrid (feature folders + technology subfolders like `features/graph-navigation/components/`). This was rejected because it adds nesting depth without adding clarity — the feature name already implies the components live there.

### Decision 2: Layered Architecture for Backend

**Choice:** Strict layer separation: `api/` → `service/` → `repository/` → `models/` (and `core/` for shared infra).

**Rationale:** FastAPI routes handle HTTP semantics (request parsing, response formatting). Business logic belongs in services. Data access belongs in repositories. Models define domain entities and DB schema. Crossing these lines (e.g., routes calling repositories directly) leads to duplicated logic and hard-to-test code.

```
backend/
├── api/
│   ├── routes/              ← FastAPI routers
│   ├── dependencies/        ← get_db, get_current_user (if auth added later)
│   └── schemas/             ← Pydantic request/response models
├── service/                 ← Business logic (node_service.py, chat_service.py, etc.)
├── repository/              ← Data access (node_repo.py, chat_repo.py, etc.)
├── models/                  ← SQLModel domain classes
├── core/                    ← config.py, database.py, exceptions.py
└── main.py
```

**Rule:** `api` calls `service`, `service` calls `repository`. Direct imports from `models` are allowed at all layers. `core/` is shared utilities.

**Alternative considered:** "Simplified" flat structure with modules. Rejected because the data model already has significant complexity (Node, ChatMessage, Correction, CompactionStep, PracticeAttempt, Memory) and layering enforces discipline.

### Decision 3: Skeleton Only, With One Exception — `/health`

**Choice:** This change produces only empty feature directories and layer directories — no stub implementations, no placeholder API routes. The **one exception** is the existing `/health` endpoint, which must keep working because `backend/tests/test_health.py` asserts it.

**Rationale:** The skeleton's job is to establish structure. Adding stub code creates the temptation to keep it, leading to "feature-shaped holes" that need filling later. Empty directories with `index.ts` / `__init__.py` export files are enough.

`/health` is not a stub — it is a live, tested endpoint that predates this change. Layering it is the smallest possible proof that the `api/` layer actually works:

```
backend/main.py              ← constructs FastAPI app, mounts api router, keeps CORS
backend/api/routes/health.py ← the /health route handler moves here
backend/service/             ← empty
backend/repository/          ← empty
backend/models/              ← empty
frontend/src/features/       ← empty feature dirs
```

`/health` returns a static payload, so it needs no service or repository layer — the route is the whole implementation. Do not invent a `health_service` to satisfy symmetry.

**Alternative considered:** Leaving `/health` inline in `main.py` and creating `api/routes/` empty. Rejected because it leaves the `api/` layer unexercised, so a wiring mistake wouldn't surface until Phase 2.

### Decision 4: Sibling `frontend/` and `backend/` Directories — *already landed*

**Choice:** Both `frontend/` and `backend/` live as siblings under the repo root, not nested. **This is already true in the repo; recorded here as the standing constraint, not as work to do.**

**Rationale:** This mirrors how Tauri 2 expects the frontend (Vite/React) to live separately from the Rust sidecar. Having them at the same level makes `npm run dev` and the backend dev server equally accessible from the repo root.

**Alternative considered:** Nesting `backend/` inside `frontend/`. Rejected because the backend is not a frontend dependency — it could serve a CLI companion or be extracted for other frontends.

### Decision 5: Backend Runs As a `uv` Project From `backend/`

**Choice:** The canonical backend dev command is `cd backend && uv run uvicorn main:app --port 8000 --reload`, already wired as `npm run backend:dev` at the repo root.

**Rationale:** `backend/` is a self-contained `uv` project with its own `pyproject.toml` and `.venv`. There is no `backend/__init__.py`, so `uvicorn backend.main:app` from the repo root does not import — and making it work would mean adding a package marker plus rewiring the root scripts, for no benefit. The module path is `main:app` because `uv run` executes with `backend/` as the working directory.

**Consequence:** `roadmap.md` Phase 0 must be corrected — its bullet claims `uvicorn backend.main:app --reload` from the repo root while its own Demo line says "in `backend/`".

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Moving `App.tsx` breaks its importers** — `main.tsx` and `App.test.tsx` both import `./App` | Move and update both importers in the same task; run `npm test` before moving on |
| **Layering `main.py` breaks pytest** — `tests/test_health.py` and `tests/conftest.py` import from `main` | Keep `main.py` as the ASGI entry point so `main:app` stays valid; run `uv run pytest` after rewiring |
| **Developers confuse `src-tauri/` vs `frontend/` paths** | Document clearly: `src-tauri/` = Tauri config + Rust only, `frontend/` = React app |
| **Empty feature directories create "ghost folders"** that never get implemented | Feature dirs created only when first code is added (enforced by convention, not tool) |
| **Layer discipline slips** — routes calling repos directly | Add a lint rule (e.g. `import-linter` for Python, `eslint-plugin-import` boundaries for TS) in a later phase |

## Migration Plan

1. **Create** `frontend/src/features/`, `frontend/src/shared/`, `frontend/src/app/` directories
2. **Move** `frontend/src/App.tsx` → `frontend/src/app/App.tsx`, then update the import in `frontend/src/main.tsx` and in `frontend/src/App.test.tsx` (or relocate the test alongside its subject)
3. **Verify** `npm test` and `npm run build` still pass in `frontend/`
4. **Create** `backend/api/`, `backend/service/`, `backend/repository/`, `backend/models/`, `backend/core/` with `__init__.py` in each
5. **Move** the `/health` handler into `backend/api/routes/health.py`; reduce `backend/main.py` to app construction, CORS, and router mounting
6. **Verify** `uv run pytest` still passes in `backend/` and `/health` still responds
7. **Update** `openspec/roadmap.md` Phase 0 to state the correct backend run command

**Rollback:** `git mv` restores the previous layout. No data migration needed — this is purely organizational.

## Open Questions

- **Q: Should `frontend/src/App.test.tsx` move next to `App.tsx` in `app/`?** Co-locating tests with subjects fits scream architecture better than a flat test root. Decided during implementation — either way, the import must be corrected.
- **Q: What is the stray `frontend/frontend/e2e` directory?** An artifact of an earlier move. Out of scope here; flag it separately rather than silently deleting it.
- **Q: Should this change include a CI check that enforces layer boundaries?** Not yet — adds complexity before it's needed. Revisit when the Phase 4+ provider layer is stable.
