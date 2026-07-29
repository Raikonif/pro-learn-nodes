# Frontend Unit Testing

## Purpose

Define how the React frontend is unit- and component-tested: Vitest as the runner, React Testing Library for component behavior, and test files co-located with the source they cover.

## Requirements

### Requirement: Vitest Configured and Operational
The frontend SHALL have Vitest configured via `vitest.config.ts` and operational via `npm test`. Running `npm test` SHALL execute all `*.test.ts` and `*.test.tsx` files in the project.

#### Scenario: npm test runs successfully
- **WHEN** a developer runs `npm test` in `frontend/`
- **THEN** Vitest discovers and runs all `*.test.ts` files and exits with code 0

### Requirement: React Testing Library Available
`@testing-library/react` SHALL be importable in test files and used for rendering and asserting on React components. A setup file SHALL register `@testing-library/jest-dom` matchers so assertions such as `toBeInTheDocument()` are available.

#### Scenario: Rendering a component in a test
- **WHEN** a test file imports `render` and `screen` from `@testing-library/react` and renders a component
- **THEN** the component mounts in the jsdom environment and `screen` queries resolve against it

#### Scenario: jest-dom matchers are registered
- **WHEN** a test asserts `expect(element).toBeInTheDocument()`
- **THEN** the matcher is available without the test file importing it directly, because the Vitest setup file registers it globally

### Requirement: Co-located Test Files
Each feature module under `frontend/src/features/` SHALL have a co-located `*.test.ts` or `*.test.tsx` file. The test file SHALL be in the same directory as the source module it tests.

#### Scenario: Test sits beside its subject
- **WHEN** a source module lives at `frontend/src/app/App.tsx`
- **THEN** its test lives at `frontend/src/app/App.test.tsx` in the same directory, not in a separate top-level test tree

#### Scenario: Moving a module moves its test
- **WHEN** a source module is relocated to a different directory
- **THEN** its co-located test file moves with it in the same step, so the relative import between them stays valid

### Requirement: Test Naming Convention
Test files SHALL be named `*.test.ts` or `*.test.tsx`. Test descriptions SHALL use descriptive names: `describe("FeatureName", () => { it("does X when Y", ...); })`.

#### Scenario: Test file is discovered by the runner
- **WHEN** a file under `frontend/src/` is named with the `.test.ts` or `.test.tsx` suffix
- **THEN** Vitest discovers it automatically via its include pattern, while a source file carrying no test suffix is not collected

### Requirement: First Tests Cover Skeleton
The initial test suite SHALL include:
- A smoke test for `App.tsx` rendering without crashing
- A smoke test for the backend health check (`/health` endpoint)

#### Scenario: Smoke test for App component
- **WHEN** the test suite runs
- **THEN** there is a test that renders `App` and asserts it displays "Learn Nodes"
