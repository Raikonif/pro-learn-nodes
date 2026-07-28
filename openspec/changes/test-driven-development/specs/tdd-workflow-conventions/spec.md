## ADDED Requirements

### Requirement: Test Files Created Alongside New Source Modules
When a new feature module is added to `frontend/src/features/<name>/` or `backend/service/` or `backend/repository/`, a corresponding test file SHALL be created at the same time (co-located, same base name with `test_` prefix or `.test.` infix).

### Requirement: Test File Naming
Frontend test files SHALL use `*.test.ts` or `*.test.tsx`. Backend test files SHALL use `test_*.py` or `*_test.py` pattern.

### Requirement: Test Suite Runs in CI
Both frontend (`npm test`) and backend (`pytest`) test suites SHALL run in GitHub Actions on every pull request and MUST pass before merging.

### Requirement: E2E Tests Run Separately
E2E Playwright tests SHALL run via `npx playwright test` separately from unit tests (`npm test`). They MAY be triggered on every PR or on PRs with a specific label (e.g., `run-e2e`).

#### Scenario: New feature module added without test
- **WHEN** a pull request adds a new source file to `frontend/src/features/<name>/` or `backend/service/`
- **THEN** a reviewer SHALL note that the corresponding test file is missing

#### Scenario: PR fails CI tests
- **WHEN** a pull request is opened with failing tests
- **THEN** CI SHALL report the failure and the PR SHALL NOT be mergeable until tests pass
