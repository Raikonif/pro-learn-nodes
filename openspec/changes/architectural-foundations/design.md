## Context

The project is in early phases (Phase 1 of 15 planned). The current structure places all frontend code under `src-tauri/src/` alongside Tauri configuration. As the project grows to include graph navigation, AI providers, skills, MCP integrations, and practice systems, organizing code by "what it does" rather than "what technology it uses" is essential.

The backend FastAPI application currently has no enforced layer separation, risking tangled request handling, business logic, and data access.

Key constraints:
- Tauri 2 is the app shell — `src-tauri/` is the Tauri project root, not a general `src/` directory
- FastAPI runs as a sidecar binary, started alongside the Tauri app
- Frontend uses React 19 + TypeScript + Vite + Tailwind CSS
- Backend uses Python 3.13+ with FastAPI, SQLModel, Pydantic v2, Alembic

## Goals / Non-Goals

**Goals:**
- Establish clear directory boundaries: `frontend/` for React app, `backend/` for FastAPI
- Adopt scream architecture for frontend: feature-first folder structure under `frontend/src/`
- Adopt layered architecture for backend: `api/`, `service/`, `repository/`, `models/`, `core/` under `backend/`
- Add Phase 0 to the roadmap: pure structural separation with no feature code
- Update OpenSpec planning docs (`tech-stack.md`, `roadmap.md`) to reflect the architectural decisions

**Non-Goals:**
- Migrating any existing feature code (that's a later phase concern)
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

### Decision 3: Phase 0 as Structural Separation Only

**Choice:** Phase 0 produces only empty feature directories and layer directories — no stub implementations, no placeholder API routes.

**Rationale:** Phase 0's job is to establish the skeleton. Adding stub code in Phase 0 creates the temptation to keep it, leading to "feature-shaped holes" that need filling later. Empty directories with `index.ts` / `__init__.py` export files are enough.

```
frontend/src/features/        ← empty feature dirs
backend/api/routes/           ← empty route dirs
backend/service/              ← empty service dirs
backend/repository/          ← empty repo dirs
```

**Alternative considered:** Stubs (one placeholder route, one placeholder component). Rejected because Phase 1 already starts with scaffolding — stubs would be redundant.

### Decision 4: Sibling `frontend/` and `backend/` Directories

**Choice:** Both `frontend/` and `backend/` live as siblings under the repo root, not nested.

**Rationale:** This mirrors how Tauri 2 expects the frontend (Vite/React) to live separately from the Rust sidecar. Having them at the same level makes `npm run tauri dev` and `uvicorn backend.main:app` equally accessible from the repo root.

**Alternative considered:** Nesting `backend/` inside `frontend/`. Rejected because the backend is not a frontend dependency — it could serve a CLI companion or be extracted for other frontends.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Migration during active development** causes merge conflicts | Phase 0 happens before any Phase 1 feature work begins |
| **Developers confuse `src-tauri/` vs `frontend/` paths** | Document clearly: `src-tauri/` = Tauri config + Rust, `frontend/` = React app |
| **Empty feature directories create "ghost folders"** that never get implemented | Feature dirs created only when first code is added (enforced by convention, not tool) |
| **Layer discipline slips** — routes calling repos directly | Add a lint rule (e.g., flake8-import-rule or eslint import-rules plugin) in a later phase |

## Migration Plan

1. **Create** `frontend/` directory at repo root, move `src-tauri/src/` → `frontend/src/`, `src-tauri/public/` → `frontend/public/`
2. **Create** `backend/` directory at repo root, move backend FastAPI files into layered structure
3. **Create** `frontend/src/features/`, `frontend/src/shared/`, `frontend/src/app/` empty directories
4. **Create** `backend/api/`, `backend/service/`, `backend/repository/`, `backend/models/`, `backend/core/` empty directories
5. **Update** `package.json` scripts to reference `frontend/` directory
6. **Update** OpenSpec docs: `tech-stack.md`, `roadmap.md`, `mission.md`
7. **Verify** `npm run dev` in `frontend/` and `uvicorn backend.main:app` in `backend/` both work independently

**Rollback:** Git mv commands can restore the previous structure if Phase 0 proves wrong. No data migration needed — this is purely organizational.

## Open Questions

- **Q: Should `src-tauri/` be renamed to avoid confusion?** Currently `src-tauri/` contains both Rust code and the React frontend. Renaming to just `tauri/` (Rust only) + `frontend/` (React) would be cleaner but requires more path updates. Defer to Phase 1 scaffolding.
- **Q: Where does the Tauri Rust code live?** It stays in `src-tauri/src-tauri/src/` (the Rust project within the Tauri directory). The React frontend is NOT part of the Tauri Rust project — it builds separately via Vite.
- **Q: Should Phase 0 include a CI check that enforces layer boundaries?** Not yet — adds complexity before it's needed. Revisit when Phase 4+ provider layer is stable.
