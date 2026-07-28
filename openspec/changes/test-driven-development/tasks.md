## 1. Frontend Vitest Setup

- [x] 1.1 Create `frontend/vitest.config.ts` — configure Vitest for React + TypeScript + Vite
- [x] 1.2 Add `npm test` script to `frontend/package.json` if not present
- [x] 1.3 Verify `npm test` runs and exits cleanly (0 tests initially, no errors)

## 2. Frontend React Testing Library Setup

- [x] 2.1 Verify `@testing-library/react` is importable in test files
- [x] 2.2 Create `frontend/src/setup-vitest.ts` or configure `vitest.config.ts` with `@testing-library/jest-dom`
- [x] 2.3 Write smoke test: `frontend/src/App.test.tsx` — renders App, asserts "Learn Nodes" is visible
- [x] 2.4 Run `npm test` and confirm smoke test passes

## 3. Frontend Playwright E2E Setup

- [x] 3.1 Create `frontend/playwright.config.ts` — configure headless Chromium, `frontend/e2e/` test dir
- [x] 3.2 Add `npx playwright install` bootstrap step
- [x] 3.3 Create `frontend/e2e/app.spec.ts` — tests app launches, backend health check passes
- [x] 3.4 Run `npx playwright test` and confirm E2E test passes

## 4. Backend Pytest Setup

- [x] 4.1 Verify `pytest`, `pytest-asyncio`, `httpx` are installed via `uv sync --extra test`
- [x] 4.2 Configure `pytest.ini` or `[tool.pytest.ini_options]` in `backend/pyproject.toml`
- [x] 4.3 Create `backend/tests/` directory with `__init__.py`
- [x] 4.4 Create `backend/tests/conftest.py` — provides test database fixture and AsyncClient fixture
- [x] 4.5 Write smoke test: `backend/tests/test_health.py` — `GET /health` returns `{"status": "ok", "backend": "fastapi"}`
- [x] 4.6 Run `pytest` and confirm smoke test passes

## 5. GitHub Actions CI

- [x] 5.1 Create `.github/workflows/test.yml`
- [x] 5.2 Frontend job: checkout → npm ci → npm test → npx playwright test
- [x] 5.3 Backend job: checkout → uv sync --extra test → pytest
- [x] 5.4 Verify workflow runs on the current branch (or trigger a test run)

## 6. TDD Workflow Documentation

- [x] 6.1 Document test naming and co-location conventions in `frontend/README.md` and `backend/README.md`
- [x] 6.2 Verify both suites run in CI and both pass
