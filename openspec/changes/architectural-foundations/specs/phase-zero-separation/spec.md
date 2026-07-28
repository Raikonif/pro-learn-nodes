## ADDED Requirements

### Requirement: Frontend Directory Is Repo Root Sibling
The `frontend/` directory SHALL exist as a sibling to `backend/`, `src-tauri/`, and `openspec/` at the repository root. All React/Vite source code SHALL live under `frontend/src/`.

### Requirement: Backend Directory Is Repo Root Sibling
The `backend/` directory SHALL exist as a sibling to `frontend/` at the repository root. All FastAPI Python code SHALL live under `backend/`.

### Requirement: Frontend Builds Independently
The frontend SHALL be runnable via `npm run dev` from within `frontend/` without any code from `backend/` present. The `frontend/` directory SHALL have its own `package.json`, `vite.config.ts`, and `tsconfig.json`.

### Requirement: Backend Runs Independently
The backend SHALL be runnable via `uvicorn backend.main:app --reload` from the repo root without any code from `frontend/` present. The `backend/` directory SHALL have its own `pyproject.toml` with all Python dependencies declared.

### Requirement: Phase 0 Produces Empty Skeleton Only
Phase 0 SHALL create only the directory structure and configuration files. No feature-specific stub code SHALL be implemented. Feature directories SHALL contain only an `index.ts` or `__init__.py` file that exports nothing.

### Requirement: OpenSpec Docs Updated
The OpenSpec planning documents SHALL be updated to reflect the new architecture: `tech-stack.md` SHALL document the scream architecture and layered architecture patterns, and `roadmap.md` SHALL show Phase 0 as the first phase.

#### Scenario: Developer runs frontend dev server
- **WHEN** a developer runs `npm run dev` in `frontend/`
- **THEN** the Vite dev server starts on localhost with hot reload working

#### Scenario: Developer runs backend dev server
- **WHEN** a developer runs `uvicorn backend.main:app --reload` from the repo root
- **THEN** the FastAPI server starts and responds to `/health` at port 8000

#### Scenario: No cross-directory imports exist
- **WHEN** Phase 0 is complete
- **THEN** no TypeScript file under `frontend/` imports from `backend/` and no Python file under `backend/` imports from `frontend/`
