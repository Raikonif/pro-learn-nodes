## ADDED Requirements

### Requirement: Test Files Created Alongside New Source Modules
When a new feature module is added to `frontend/src/features/<name>/` or `backend/service/` or `backend/repository/`, a corresponding test file SHALL be created at the same time (co-located, same base name with `test_` prefix or `.test.` infix).

#### Scenario: New feature module added without test
- **WHEN** a pull request adds a new source file to `frontend/src/features/<name>/` or `backend/service/`
- **THEN** a reviewer SHALL note that the corresponding test file is missing

### Requirement: Test File Naming
Frontend test files SHALL use `*.test.ts` or `*.test.tsx`. Backend test files SHALL use `test_*.py` pattern.

#### Scenario: Naming determines which runner claims a file
- **WHEN** a test file is named `*.test.tsx` under `frontend/src/` or `test_*.py` under `backend/`
- **THEN** Vitest and pytest respectively discover it automatically, and a file that does not follow the pattern is silently not run

### Requirement: Test Suite Runs in CI
Frontend (`npm test`) and backend (`pytest`) test suites — i.e., unit and integration tests — SHALL run in GitHub Actions on every pull request and MUST pass before merging. E2E tests are governed by the separate "E2E Tests Run Separately" requirement and are NOT part of the per-PR merge gate.

#### Scenario: PR fails CI tests
- **WHEN** a pull request is opened with failing tests
- **THEN** CI SHALL report the failure and the PR SHALL NOT be mergeable until tests pass

### Requirement: E2E Tests Run Separately
E2E Playwright tests SHALL run via `npx playwright test` separately from unit tests (`npm test`). They MAY be triggered on every PR or on PRs with a specific label (e.g., `run-e2e`).

#### Scenario: Unit run does not require a backend
- **WHEN** a developer runs `npm test`
- **THEN** only Vitest unit tests execute, with no browser launched and no backend required, so the fast suite stays fast
