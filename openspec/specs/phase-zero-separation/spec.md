# Phase Zero Separation

## Purpose

Define the repository boundaries and independent run commands for the frontend, backend, Tauri shell, and OpenSpec artifacts during the foundational phase.

## Requirements

### Requirement: Frontend Directory Is Repo Root Sibling
The `frontend/` directory SHALL exist as a sibling to `backend/`, `src-tauri/`, and `openspec/` at the repository root. All React/Vite source code SHALL live under `frontend/src/`.

#### Scenario: Locating React source
- **WHEN** a developer looks for a React component
- **THEN** it is found under `frontend/src/` and never under `src-tauri/`

### Requirement: Backend Directory Is Repo Root Sibling
The `backend/` directory SHALL exist as a sibling to `frontend/` at the repository root. All FastAPI Python code SHALL live under `backend/`.

#### Scenario: Locating Python source
- **WHEN** a developer looks for a FastAPI route
- **THEN** it is found under `backend/` and never under `frontend/` or `src-tauri/`

### Requirement: Tauri Directory Holds Rust Only
The `src-tauri/` directory SHALL contain only Tauri configuration and Rust sources. No React, TypeScript, or Python source file SHALL be placed under `src-tauri/`.

#### Scenario: Tauri directory stays Rust-only
- **WHEN** this change is complete
- **THEN** `src-tauri/src/` contains only Rust sources and no TypeScript source has been moved into it

### Requirement: Frontend Builds Independently
The frontend SHALL be runnable via `npm run dev` from within `frontend/` without any code from `backend/` present. The `frontend/` directory SHALL have its own `package.json`, `vite.config.ts`, and `tsconfig.json`.

#### Scenario: Developer runs frontend dev server
- **WHEN** a developer runs `npm run dev` in `frontend/` with the backend stopped
- **THEN** the Vite dev server starts on localhost with hot reload working

### Requirement: Backend Runs Independently
The backend SHALL be runnable via `uv run uvicorn main:app --port 8000 --reload` from within `backend/` without any code from `frontend/` present. The `backend/` directory SHALL have its own `pyproject.toml` with all Python dependencies declared. The repo-root `package.json` SHALL expose this as `npm run backend:dev`.

#### Scenario: Developer runs backend dev server
- **WHEN** a developer runs `uv run uvicorn main:app --port 8000 --reload` from within `backend/`
- **THEN** the FastAPI server starts and responds to `/health` at port 8000

#### Scenario: Repo-root convenience script
- **WHEN** a developer runs `npm run backend:dev` from the repository root
- **THEN** the same server starts, because the script changes into `backend/` first

### Requirement: Skeleton Only, No New Feature Code
This change SHALL create only directory structure, configuration files, and the relocation of code that already exists. No new feature-specific behavior SHALL be implemented. Newly created feature and layer directories SHALL contain only an `index.ts` or `__init__.py` file that exports nothing.

#### Scenario: Newly created feature directory
- **WHEN** `frontend/src/features/graph-navigation/` is created
- **THEN** it contains only an `index.ts` that exports nothing, and no component implementation

### Requirement: Existing Endpoints And Tests Survive Restructuring
The `/health` endpoint SHALL continue to respond after the backend is layered, and SHALL be served from `backend/api/routes/`. All test suites that pass before the restructuring SHALL pass after it: `frontend` Vitest, `frontend` Playwright e2e, and `backend` pytest. Any file move SHALL update every importer of the moved module in the same step.

#### Scenario: Test suites survive the restructuring
- **WHEN** `App.tsx` is moved into `app/` and the `/health` handler is moved into `api/routes/`
- **THEN** `npm test` in `frontend/` and `uv run pytest` in `backend/` both pass, with no test file importing a path that no longer exists

#### Scenario: Health endpoint after layering
- **WHEN** the backend starts after `/health` has been moved to `backend/api/routes/health.py`
- **THEN** `GET /health` still returns `{"status": "ok", "backend": "fastapi"}`

### Requirement: No Cross-Directory Imports
No TypeScript file under `frontend/` SHALL import from `backend/`, and no Python file under `backend/` SHALL import from `frontend/`. The two sides communicate only over HTTP.

#### Scenario: No cross-directory imports exist
- **WHEN** this change is complete
- **THEN** no TypeScript file under `frontend/` imports from `backend/` and no Python file under `backend/` imports from `frontend/`

### Requirement: Roadmap Reflects The Real Run Command
`openspec/roadmap.md` Phase 0 SHALL state the backend run command consistently as being run from within `backend/`, resolving the current contradiction between its bullet list and its Demo line.

#### Scenario: Reading the roadmap
- **WHEN** a developer reads Phase 0 in `openspec/roadmap.md` and copies the backend command
- **THEN** the command works as written, and the bullet list and Demo line do not disagree
