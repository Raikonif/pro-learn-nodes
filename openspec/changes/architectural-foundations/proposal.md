## Why

The repo-root split between `frontend/` and `backend/` already exists, but neither side has an *internal* structural convention. `frontend/src/` holds `App.tsx` and `main.tsx` flat at its root; `backend/` holds a single `main.py` with no layer boundaries. As the project grows to 15 phases with graph navigation, AI providers, skills, MCP, and practice systems, organizing code by "what it does" rather than "what technology it uses" becomes critical for navigability and long-term maintainability.

Adopting scream architecture for the frontend and layered architecture for the backend establishes clear contracts between layers before feature development begins — while the codebase is still small enough that the reorganization is cheap.

## What Changes

- **Frontend**: Introduce a **scream architecture** inside `frontend/src/` — feature-first organization under `features/`, with `shared/` for cross-cutting code and `app/` for the app shell. Existing `App.tsx` moves into `app/`.
- **Backend**: Introduce a **layered architecture** inside `backend/` — `api/`, `service/`, `repository/`, `models/`, `core/`. Existing `main.py` is rewired to mount the `api/` router.
- **Tests stay green**: The `test-driven-development` change is already complete. Moving `App.tsx` and `main.py` breaks `frontend/src/App.test.tsx` and `backend/tests/test_health.py` unless their imports are updated in the same step.

**Already landed — not part of this change:**
- `frontend/` and `backend/` exist as repo-root siblings with their own `package.json` / `pyproject.toml`
- `openspec/tech-stack.md` documents both architecture patterns
- `openspec/roadmap.md` has Phase 0 — Project Separation

## Capabilities

### New Capabilities
- `frontend-scream-architecture`: Feature-first folder organization for the React frontend — `features/`, `shared/`, `app/` as top-level directories
- `backend-layered-architecture`: Strict layer separation for the FastAPI backend — `api/`, `service/`, `repository/`, `models/`, `core/`
- `phase-zero-separation`: A pre-Phase-1 milestone that establishes `frontend/` and `backend/` as sibling directories with independent build/run workflows

### Modified Capabilities
- *(none — no existing capability requirements change)*

## Impact

- **Directories created**: `frontend/src/features/`, `frontend/src/shared/`, `frontend/src/app/`, `backend/api/`, `backend/service/`, `backend/repository/`, `backend/models/`, `backend/core/`
- **Files moved**: `frontend/src/App.tsx` → `frontend/src/app/App.tsx`; `backend/main.py` retained as the ASGI entry point but reduced to app construction + router mounting
- **Files that must be updated in lockstep**: `frontend/src/main.tsx` and `frontend/src/App.test.tsx` (both import `./App`); `backend/tests/test_health.py` and `backend/tests/conftest.py` (both import from `main`)
- **`src-tauri/` is untouched** — it already contains only Tauri config and Rust sources (`src-tauri/src/lib.rs`, `src-tauri/src/main.rs`)
- **Build impact**: none to the run commands. Frontend still runs via `npm run dev` in `frontend/`; backend still runs via `cd backend && uv run uvicorn main:app --port 8000 --reload` (wired as `npm run backend:dev` at the repo root)
- **OpenSpec files updated**: `openspec/roadmap.md` — correct the Phase 0 backend run command, which currently contradicts itself (bullet says repo root, Demo says `backend/`)
