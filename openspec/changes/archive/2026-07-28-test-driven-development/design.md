## Context

The project is starting Phase 1 with no test infrastructure in place. `frontend/package.json` has been updated to include Vitest, React Testing Library, and Playwright. `backend/pyproject.toml` has been updated with pytest and pytest-asyncio. This change activates those dependencies and establishes the TDD conventions.

Key constraints:
- Frontend uses React 19 + TypeScript + Vite (already set up)
- Backend uses FastAPI + SQLModel + Python 3.13+
- Frontend and backend use scream and layered architectures respectively — tests must respect those boundaries
- GitHub Actions CI is already referenced in `tech-stack.md`

## Goals / Non-Goals

**Goals:**
- Both test suites (`npm test` and `pytest`) run and pass from day one
- Test files are co-located with the source they test (`features/graph-navigation/graph-navigation.test.ts`)
- E2E Playwright tests cover the critical path available at this phase: app launch and backend health check. Graph canvas rendering is deferred to the phase that introduces the graph view.
- Backend tests cover service and repository layers (not API routes directly — those are integration tested via httpx)
- TDD conventions are documented so future phases follow them consistently

**Non-Goals:**
- Full test coverage — this change establishes the infrastructure, not complete coverage
- Testing the Tauri shell itself (Rust code)
- Performance testing or load testing
- Snapshot testing (unless a specific feature team chooses it)

## Decisions

### Decision 1: Co-located Test Files

**Choice:** `*.test.ts` and `test_*.py` files live in the same directory as the source they test, not in a separate `tests/` top-level directory.

```
frontend/src/features/graph-navigation/
├── components/
│   └── SpatialCanvas.tsx
└── graph-navigation.test.ts    ← co-located with source

backend/service/
├── node_service.py
└── test_node_service.py        ← co-located with source
```

**Rationale:** Co-location makes it obvious that tests exist and keeps them in sync with refactoring. A separate `tests/` directory is easier to forget when adding new modules. The co-located approach enforces that every module has a test partner.

**Alternative considered:** Top-level `tests/` directory. Rejected — it creates an "test code vs. prod code" mental separation that discourages keeping tests current.

### Decision 2: Backend Tests Test Services and Repositories, Not Routes Directly

**Choice:** Unit tests focus on service and repository classes. API routes are tested via integration tests using httpx's `AsyncClient`.

**Rationale:** Routes are thin — they parse requests and call services. The business logic lives in services. Testing services directly gives better failure localization. Route-level integration tests via httpx cover the request/response contract.

**Layout:** Per Decision 1, **unit tests are co-located** with the source module. The top-level `backend/tests/` directory exists for **shared fixtures and integration tests only** (httpx-driven route tests, `conftest.py`). It is not a general "all backend tests" directory.

```
backend/service/
├── node_service.py
└── test_node_service.py        ← unit test, co-located (Decision 1)

backend/repository/
├── node_repository.py
└── test_node_repository.py     ← unit test, co-located (Decision 1)

backend/tests/
├── conftest.py              ← shared fixtures
└── test_health.py           ← integration test (httpx)
```

**Alternative considered:** Testing routes as the primary backend test strategy. Rejected — route handlers change often (e.g., adding a query param), and route tests don't verify business logic correctness.

### Decision 3: Vitest as Primary Unit/Integration Runner for Frontend

**Choice:** Vitest runs all frontend unit and integration tests (React component tests via React Testing Library).

**Rationale:** Vitest is API-compatible with Jest, faster, and written in Rust. It integrates naturally with Vite. React Testing Library is already installed.

### Decision 4: Playwright for E2E Tests

**Choice:** Playwright runs browser-based E2E tests for critical user journeys.

**Rationale:** Already in `frontend/package.json`. Covers the gap between unit tests (does this component work?) and real usage (does the whole app flow work?). Playwright tests are stored in `frontend/e2e/` and run separately from unit tests.

### Decision 5: GitHub Actions CI Runs Both Suites

**Choice:** A single `test.yml` workflow runs `npm test` and `pytest` on every PR.

**Rationale:** Keeping both test suites in one workflow ensures they stay in sync with the PR that introduces them.

The actual workflow lives at `.github/workflows/test.yml`. Key implementation notes:
- Backend: `uv sync --extra test` then `uv run pytest` (pytest is in the venv, not on PATH).
- Frontend E2E: the spec at `frontend/e2e/app.spec.ts` calls `GET http://localhost:8000/health` from the browser, so the frontend job spins up its own backend in the background (`uv run uvicorn main:app`) and waits for `/health` to respond before running Playwright.
- The two jobs run in parallel; neither depends on the other.

```
name: Test
on: [pull_request, push:branches:main]
jobs:
  backend:
    steps:
      - run: uv sync --extra test      # working-directory: backend
      - run: uv run pytest             # working-directory: backend
  frontend:
    steps:
      - run: npm ci                    # working-directory: frontend
      - run: npm test                  # unit, working-directory: frontend
      - run: npx playwright install chromium
      - run: uv sync --extra test      # for the E2E backend service
      - run: (start uvicorn in background, wait for /health)
      - run: npx playwright test
      - run: (stop uvicorn, if: always())
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Tests are written but not maintained** — test debt grows | Enforce in PR review: new features require tests; changed features require updating tests |
| **Slow CI** — both suites could take minutes | Run unit tests in parallel; E2E tests only on significant PRs (label-triggered) |
| **Mock overload** — tests become tightly coupled to implementation | Prefer integration tests over mocks; mock only external dependencies (LLM providers, MCP servers) |
| **React Testing Library tests are brittle** — DOM tests break on CSS changes | Use `data-testid` attributes sparingly; prefer behavior tests over DOM structure tests |

## Migration Plan

1. **Install dependencies** — `npm install` in `frontend/`, `uv sync` in `backend/` (already done via package.json/pyproject.toml updates)
2. **Create config files** — `vitest.config.ts`, `playwright.config.ts`, `pytest.ini`
3. **Create `conftest.py`** — backend test fixtures. An `AsyncClient` fixture bound to the FastAPI app. No test-database fixture: no database exists yet, so it is deferred to the data-model phase.
4. **Write first passing tests** — a smoke test for `backend/main.py`'s `/health` route and a smoke test for `frontend/src/App.tsx`
5. **Add GitHub Actions workflow** — `.github/workflows/test.yml`
6. **Verify CI passes** — both suites green on the first merged PR

**Rollback:** Remove `vitest.config.ts`, `playwright.config.ts`, `pytest.ini`, and `.github/workflows/test.yml`. Tests remain in source tree but aren't run.

## Open Questions

- **Q: Should E2E tests run on every PR or only on label?** Running on every PR adds CI time. A label like `run-e2e` could trigger them selectively.
- **Q: What is the minimum acceptable coverage?** Not defined yet — could be tracked via a coverage tool (Vitest coverage v8, pytest-cov) in a follow-up phase.
- **Q: Should tests use type-safe mocks?** For TypeScript: `vi.mock()` from Vitest. For Python: `pytest-mock` or `unittest.mock`. Both are built into their respective ecosystems.
