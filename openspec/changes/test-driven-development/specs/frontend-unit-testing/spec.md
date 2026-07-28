## ADDED Requirements

### Requirement: Vitest Configured and Operational
The frontend SHALL have Vitest configured via `vitest.config.ts` and operational via `npm test`. Running `npm test` SHALL execute all `*.test.ts` and `*.test.tsx` files in the project.

### Requirement: React Testing Library Available
`@testing-library/react` SHALL be importable in test files and used for rendering and asserting on React components.

### Requirement: Co-located Test Files
Each feature module under `frontend/src/features/` SHALL have a co-located `*.test.ts` or `*.test.tsx` file. The test file SHALL be in the same directory as the source module it tests.

### Requirement: Test Naming Convention
Test files SHALL be named `*.test.ts` or `*.test.tsx`. Test descriptions SHALL use descriptive names: `describe("FeatureName", () => { it("does X when Y", ...); })`.

### Requirement: First Tests Cover Skeleton
The initial test suite SHALL include:
- A smoke test for `App.tsx` rendering without crashing
- A smoke test for the backend health check (`/health` endpoint)

#### Scenario: npm test runs successfully
- **WHEN** a developer runs `npm test` in `frontend/`
- **THEN** Vitest discovers and runs all `*.test.ts` files and exits with code 0

#### Scenario: Smoke test for App component
- **WHEN** the test suite runs
- **THEN** there is a test that renders `App` and asserts it displays "Learn Nodes"
