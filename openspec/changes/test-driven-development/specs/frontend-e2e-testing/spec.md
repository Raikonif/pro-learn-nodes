## ADDED Requirements

### Requirement: Playwright Configured and Operational
The frontend SHALL have Playwright configured via `playwright.config.ts`. Running `npx playwright test` SHALL execute E2E tests.

### Requirement: E2E Test Directory
E2E tests SHALL live in `frontend/e2e/` and have `*.spec.ts` suffix. They SHALL NOT live in `frontend/src/`.

### Requirement: Critical Path E2E Tests
The initial E2E test suite SHALL cover at minimum:
- App launches and displays the home screen
- Backend health check passes (backend is reachable)
- Graph canvas (spatial view) renders without console errors

### Requirement: Playwright Browsers Installed
`npx playwright install` SHALL be runnable to install Chromium (and other browsers configured). The CI workflow SHALL run `npx playwright install` before executing tests.

#### Scenario: Playwright test runs headless
- **WHEN** a developer runs `npx playwright test` in `frontend/`
- **THEN** Chromium launches headless, runs all `*.spec.ts` files, and reports results
