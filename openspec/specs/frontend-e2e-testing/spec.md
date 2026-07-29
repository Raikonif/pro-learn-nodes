# Frontend E2E Testing

## Purpose

Define browser-level end-to-end coverage for the app: Playwright as the runner, tests isolated in their own directory, and a critical-path suite that exercises the real frontend against a real backend.

## Requirements

### Requirement: Playwright Configured and Operational
The frontend SHALL have Playwright configured via `playwright.config.ts`. Running `npx playwright test` SHALL execute E2E tests. The configuration SHALL define a `baseURL` and a `webServer` configuration that starts both the frontend dev server and the backend API automatically, so the suite is self-contained and requires no manual setup.

#### Scenario: Playwright test runs headless
- **WHEN** a developer runs `npx playwright test` in `frontend/`
- **THEN** Chromium launches headless, runs all `*.spec.ts` files, and reports results

#### Scenario: Servers started automatically
- **WHEN** the E2E suite starts and no server is already listening on the configured frontend or backend URL
- **THEN** Playwright starts each via its `webServer` command and waits for both URLs to respond before running the first test

### Requirement: E2E Test Directory
E2E tests SHALL live in `frontend/e2e/` and have `*.spec.ts` suffix. They SHALL NOT live in `frontend/src/`.

#### Scenario: E2E and unit tests do not collide
- **WHEN** `npm test` runs Vitest
- **THEN** it collects only files under `frontend/src/` and does NOT pick up the Playwright specs in `frontend/e2e/`, because Vitest's include pattern is scoped to `src/**` while Playwright's `testDir` points at `e2e/`

### Requirement: Critical Path E2E Tests
The initial E2E test suite SHALL cover at minimum:
- App launches and displays the home screen
- Backend health check passes (backend is reachable)

> Coverage of the graph canvas (spatial view) rendering without console errors is NOT yet part of this capability — no graph canvas exists. It is added by the phase that introduces the graph view.

#### Scenario: App launch is verified end-to-end
- **WHEN** the E2E suite navigates to the app root
- **THEN** the home screen renders and its identifying text is visible in a real browser

#### Scenario: Backend reachability is verified from the browser
- **WHEN** the app loads with the backend running
- **THEN** the rendered backend-status indicator reads "connected"

> The assertion MUST target the connected state specifically. Asserting merely that the indicator left its initial "checking" state is a false positive: an unreachable backend also leaves that state, rendering "unavailable".

### Requirement: Playwright Browsers Installed
`npx playwright install` SHALL be runnable to install Chromium (and other browsers configured). The CI workflow SHALL run `npx playwright install` before executing tests.

#### Scenario: CI installs browsers before running E2E
- **WHEN** the CI frontend job reaches its E2E step on a fresh runner
- **THEN** `npx playwright install chromium` has already run, so the browser binary is present and the suite does not fail on a missing executable
