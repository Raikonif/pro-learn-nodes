# Frontend — Learn Nodes

React 19 + TypeScript + Vite. Talks to the FastAPI backend at `http://localhost:8000` (proxied through Vite).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on `http://localhost:1420` |
| `npm run build` | Type-check (`tsc`) + production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the Vitest suite once (CI mode) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run playwright` | Playwright CLI passthrough |
| `npm run playwright:install` | Download the Chromium browser used by Playwright |

## Testing

Three tiers, each in its own directory and tool:

### Unit / component tests — Vitest + React Testing Library
- **Location:** co-located with the source under test — `src/**/*.{test,spec}.{ts,tsx}`.
- **Naming:** `Foo.test.ts` or `Foo.test.tsx`. Describe the component/feature, not the file.
- **Setup:** `src/setup-vitest.ts` registers `@testing-library/jest-dom` matchers.
- **Run:** `npm test`.

### End-to-end tests — Playwright (Chromium, headless)
- **Location:** `e2e/*.spec.ts`. Lives outside `src/` so Playwright's config doesn't try to bundle it.
- **Naming:** `feature.spec.ts`.
- **Browser:** Chromium only by default (`playwright.config.ts`). Run `npm run playwright:install` once per machine.
- **Servers:** Playwright boots both the Vite dev server and the FastAPI backend automatically (the `webServer` array in `playwright.config.ts`), so no manual setup is needed. Locally it reuses whatever is already listening; in CI it starts its own.
- **Run:** `npx playwright test`.

### CI — GitHub Actions
`.github/workflows/test.yml` has three jobs:

| Job | Runs | When |
| --- | --- | --- |
| `backend` | `uv run pytest` | Every PR — **gates merge** |
| `frontend` | `npm test` | Every PR — **gates merge** |
| `e2e` | `npx playwright test` | Only on PRs labelled `run-e2e`, on pushes to `main`, or via manual dispatch — **does not gate merge** |

E2E is deliberately kept off the per-PR merge gate so the fast suites stay the feedback loop. Add the `run-e2e` label to a PR when a change warrants browser-level verification.

## Conventions

- **Co-located tests.** Put `Foo.test.ts(x)` next to `Foo.ts(x)` in the same directory. Adding a new module under `src/features/<name>/` requires a sibling test file.
- **Behavior over DOM structure.** Prefer assertions on visible text and roles (`getByRole`, `getByText`) over CSS-class selectors.
- **`data-testid` sparingly.** Reach for it only when no accessible query works.
- **Mock external dependencies only.** LLM providers, MCP servers, and the network. Don't mock internal services — write an integration test instead.