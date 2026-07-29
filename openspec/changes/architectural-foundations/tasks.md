## 0. Preconditions

- [x] 0.1 Record the green baseline: run `npm test` and `npm run build` in `frontend/`, and `uv run pytest` in `backend/`. All must pass before any file is moved — otherwise you cannot tell whether a later failure is yours.
- [x] 0.2 Confirm `src-tauri/src/` contains only `lib.rs` and `main.rs`. If any React source is there, STOP — this plan assumes it is not.

## 1. Frontend Scream Architecture

- [x] 1.1 Create `frontend/src/shared/` with subdirectories `components/`, `hooks/`, `lib/`, each holding an `index.ts` that exports nothing
- [x] 1.2 Create `frontend/src/features/` with empty subdirectories `graph-navigation/`, `node-chat/`, `study-launcher/`, `settings/`, `practice/`
- [x] 1.3 Add an `index.ts` to each feature directory exporting nothing (the future public surface)
- [x] 1.4 Create `frontend/src/app/` with a `routes/` subdirectory
- [x] 1.5 `git mv frontend/src/App.tsx frontend/src/app/App.tsx`
- [x] 1.6 Update `frontend/src/main.tsx` — its `./App` import becomes `./app/App`
- [x] 1.7 Update `frontend/src/App.test.tsx` — either move it to `frontend/src/app/App.test.tsx` (co-located, preferred) or correct its `./App` import in place
- [x] 1.8 Verify: `npm test` passes and `npm run build` succeeds in `frontend/`

## 2. Backend Layered Architecture

- [x] 2.1 Create `backend/api/` with subdirectories `routes/`, `schemas/`, `dependencies/`
- [x] 2.2 Create `backend/service/`, `backend/repository/`, `backend/models/`, `backend/core/`
- [x] 2.3 Add `__init__.py` to every new backend directory (`api/`, `api/routes/`, `api/schemas/`, `api/dependencies/`, `service/`, `repository/`, `models/`, `core/`)
- [x] 2.4 Create `backend/core/config.py`, `backend/core/database.py`, `backend/core/exceptions.py` as minimal placeholders — settings object, connection stub, base exception class. Real SQLite wiring lands in Phase 2, not here.
- [x] 2.5 Move the `/health` handler out of `main.py` into `backend/api/routes/health.py` as an `APIRouter`
- [x] 2.6 Reduce `backend/main.py` to: FastAPI app construction, CORS middleware, and `app.include_router(...)`. It MUST remain the ASGI entry point so `main:app` stays valid.
- [x] 2.7 Verify: `uv run pytest` passes in `backend/` with `tests/test_health.py` and `tests/conftest.py` unchanged, or updated if their imports broke
- [x] 2.8 Verify: `npm run backend:dev` from the repo root starts the server and `/health` returns `{"status": "ok", "backend": "fastapi"}`

## 3. Documentation Correction

- [x] 3.1 Fix `openspec/roadmap.md` Phase 0 — the bullet says the backend runs via `uvicorn backend.main:app --reload` from the repo root, which does not work (no `backend/__init__.py`). Change it and the Demo line to agree on `cd backend && uv run uvicorn main:app --port 8000 --reload`.
- [x] 3.2 Update the `openspec/roadmap.md` Phase 0 skeleton bullet to reflect that `/health` lives in `api/routes/` rather than claiming zero code

## 4. Verify Separation

- [x] 4.1 Confirm no file under `frontend/src/` imports from `backend/`
- [x] 4.2 Confirm no file under `backend/` imports from `frontend/`
- [x] 4.3 Confirm `src-tauri/src/` still contains only Rust sources
- [x] 4.4 Confirm the frontend dev server runs with `backend/` stopped, and the backend runs with the frontend stopped
- [x] 4.5 Run the full baseline from 0.1 once more — Vitest, Playwright e2e, and pytest all green

## 5. Out Of Scope — Do Not Do

- [x] 5.1 Do NOT move `src-tauri/src/` anywhere. It holds Rust only; an earlier draft of this plan wrongly described it as the React source root.
- [x] 5.2 Do NOT create `frontend/` or `backend/`, or their `package.json` / `pyproject.toml` / `vite.config.ts` / `tsconfig.json` — all already exist.
- [x] 5.3 Do NOT edit `openspec/tech-stack.md` — it already documents both architecture patterns.
- [x] 5.4 Do NOT add an import-boundary lint rule — deferred to a later phase by design.
- [x] 5.5 Do NOT delete the stray `frontend/frontend/e2e` directory as part of this change — flag it for a separate cleanup.
