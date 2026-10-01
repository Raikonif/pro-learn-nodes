## MODIFIED Requirements

### Requirement: Playwright Configured and Operational
The frontend SHALL have Playwright configured via `playwright.config.ts`. Running `pnpm exec playwright test` SHALL execute E2E tests. The configuration SHALL derive its `baseURL` and both `webServer` entries from allocated ports rather than hardcoded ones, and SHALL start both the frontend dev server and the backend API itself, so the suite is self-contained and requires no manual setup.

The suite SHALL NOT attach to a server it did not start. Because ports are allocated before startup, a process already listening on a chosen port is an unrelated process, and attaching to it produces assertion failures that misreport an environment collision as a product defect.

#### Scenario: Playwright test runs headless
- **WHEN** a developer runs `pnpm exec playwright test` in `frontend/`
- **THEN** Chromium launches headless, runs all `*.spec.ts` files, and reports results

#### Scenario: Servers started by the suite
- **WHEN** the E2E suite starts
- **THEN** Playwright allocates ports, starts the frontend and backend on them via its `webServer` commands, and waits for both to respond before running the first test

#### Scenario: An unrelated process holds a default port
- **WHEN** an unrelated process is listening on a default dev port and the E2E suite starts
- **THEN** the suite allocates a different port and starts its own backend, and no test asserts against the unrelated process
