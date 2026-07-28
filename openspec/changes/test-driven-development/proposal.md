## Why

The project has no test coverage. As phases add AI providers, branching logic, compaction, corrections propagation, and MCP integrations, the risk of regressions grows. Writing tests after the fact produces lower-quality tests — TDD (or at minimum, test-adjacent development) ensures the architecture is testable from the start and that every feature has a machine-checkable contract.

## What Changes

- **Frontend testing setup**: Vitest + React Testing Library + Playwright configured and working in `frontend/`
- **Backend testing setup**: Pytest + pytest-asyncio + httpx configured and working in `backend/`
- **TDD workflow conventions**: Every new feature module in both frontend and backend ships with tests in a `*.test.ts` / `test_*.py` file co-located with the source
- **CI enforcement**: GitHub Actions runs frontend and backend test suites on every PR
- **Test infrastructure in OpenSpec**: `frontend-scream-architecture` and `backend-layered-architecture` specs get test-related requirements

## Capabilities

### New Capabilities
- `frontend-unit-testing`: Vitest + React Testing Library configured and operational in `frontend/`. Co-located `*.test.ts` files for each feature module.
- `frontend-e2e-testing`: Playwright configured with browser tests covering critical user journeys
- `backend-unit-testing`: Pytest + pytest-asyncio + httpx configured in `backend/`. Co-located `test_*.py` files for each service and repository
- `tdd-workflow-conventions`: Test file naming, placement, and naming conventions enforced across frontend and backend

### Modified Capabilities
- `frontend-scream-architecture`: ADDED requirement — each feature module SHALL have a co-located test file
- `backend-layered-architecture`: ADDED requirement — each service and repository SHALL have a co-located test file

## Impact

- **New files**: `frontend/vitest.config.ts`, `frontend/playwright.config.ts`, `frontend/src/*.test.ts`, `backend/tests/`, `backend/pytest.ini` or `pyproject.toml` test config, `backend/**/test_*.py`
- **Modified files**: `frontend/package.json` (already updated), `backend/pyproject.toml` (already updated)
- **GitHub Actions**: New `test.yml` workflow running `npm test` and `pytest` on PRs
- **OpenSpec specs**: `frontend-scream-architecture` and `backend-layered-architecture` specs updated with test requirements
