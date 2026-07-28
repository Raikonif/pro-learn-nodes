## 1. Create Frontend Directory Structure

- [ ] 1.1 Create `frontend/` directory at repo root
- [ ] 1.2 Move `src-tauri/src/` contents → `frontend/src/` (preserve all React/TypeScript source)
- [ ] 1.3 Move `src-tauri/public/` contents → `frontend/public/` (preserve static assets)
- [ ] 1.4 Create `frontend/src/features/` directory with empty subdirectories: `graph-navigation/`, `node-chat/`, `study-launcher/`, `settings/`, `practice/`
- [ ] 1.5 Create `frontend/src/shared/` with subdirectories: `components/`, `hooks/`, `lib/`
- [ ] 1.6 Create `frontend/src/app/` with `App.tsx` and `routes/` subdirectory
- [ ] 1.7 Add `index.ts` to each feature directory exporting an empty object

## 2. Create Backend Directory Structure

- [ ] 2.1 Create `backend/` directory at repo root
- [ ] 2.2 Create `backend/api/` with subdirectories: `routes/`, `schemas/`, `dependencies/`
- [ ] 2.3 Create `backend/service/` directory
- [ ] 2.4 Create `backend/repository/` directory
- [ ] 2.5 Create `backend/models/` directory
- [ ] 2.6 Create `backend/core/` with `config.py`, `database.py`, `exceptions.py`
- [ ] 2.7 Move existing FastAPI files (`main.py`, models, etc.) into appropriate layered directories
- [ ] 2.8 Add `__init__.py` to all backend Python directories

## 3. Configure Build Independence

- [ ] 3.1 Ensure `frontend/package.json` exists with dev/build scripts (`npm run dev`, `npm run build`)
- [ ] 3.2 Ensure `frontend/vite.config.ts` and `frontend/tsconfig.json` exist and reference correct paths
- [ ] 3.3 Ensure `backend/pyproject.toml` exists with FastAPI, SQLModel, Pydantic, Alembic dependencies
- [ ] 3.4 Verify `npm run dev` in `frontend/` starts Vite dev server
- [ ] 3.5 Verify `uvicorn backend.main:app --reload` from repo root starts FastAPI server

## 4. Update OpenSpec Documentation

- [ ] 4.1 Update `openspec/tech-stack.md` — add "Scream Architecture" section for frontend organization
- [ ] 4.2 Update `openspec/tech-stack.md` — add "Layered Architecture" section for backend organization
- [ ] 4.3 Update `openspec/roadmap.md` — prepend Phase 0: Project Separation (before current Phase 1)
- [ ] 4.4 Update `openspec/mission.md` — add architectural principles to Core Principles section if not already captured

## 5. Verify Separation

- [ ] 5.1 Confirm no `frontend/src/` files import from `backend/`
- [ ] 5.2 Confirm no `backend/` Python files import from `frontend/`
- [ ] 5.3 Confirm `src-tauri/` contains only Tauri/Rust configuration (no React source mixed in)
- [ ] 5.4 Confirm `frontend/` runs standalone without `backend/` being present
- [ ] 5.5 Confirm `backend/` runs standalone without `frontend/` being present
