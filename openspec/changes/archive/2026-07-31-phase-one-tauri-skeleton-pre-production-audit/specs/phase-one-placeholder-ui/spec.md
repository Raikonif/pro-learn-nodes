## ADDED Requirements

### Requirement: Window renders a Learn Nodes placeholder
The frontend SHALL render a single placeholder screen under `frontend/src/app/Placeholder.tsx` that displays the title "Learn Nodes", a short subtitle indicating that the app shell is wired (for example, "Phase 1 — Tauri + FastAPI skeleton"), and a backend status indicator. No router, no navigation, no graphs, no chat UI SHALL be introduced in this change.

#### Scenario: Placeholder visible on first launch
- **WHEN** the Tauri window opens for the first time
- **THEN** the visible content is the placeholder screen showing "Learn Nodes" as the largest text on the page

### Requirement: Backend status indicator reflects /health
The placeholder screen SHALL call `/health` once on mount and SHALL render a green dot with the label "Backend online" when the response validates, and a red dot with the label "Backend offline" otherwise. No polling, no retries — the indicator reflects the first attempt only.

#### Scenario: Backend reachable
- **WHEN** the FastAPI backend is running and `GET /health` returns `{"status": "ok", "backend": "fastapi"}`
- **THEN** the placeholder screen shows a green dot and the label "Backend online"

#### Scenario: Backend unreachable
- **WHEN** the FastAPI backend is not running or `/health` fails
- **THEN** the placeholder screen shows a red dot and the label "Backend offline"

### Requirement: Placeholder uses Tailwind utility classes
The placeholder screen SHALL be styled using Tailwind utility classes only (no custom CSS files, no inline `style` props). The screen SHALL be responsive down to 800×600.

#### Scenario: Styling uses Tailwind utilities
- **WHEN** the placeholder is inspected in the browser
- **THEN** the rendered HTML uses Tailwind class names and the layout remains legible at 800×600

### Requirement: Placeholder has unit and end-to-end tests
A Vitest unit test SHALL verify the placeholder renders the title text. A Playwright spec SHALL verify the window opens and the title is visible. No additional tests are required for this change.

#### Scenario: Unit test renders the title
- **WHEN** `npm test` is run in `frontend/`
- **THEN** `frontend/src/app/Placeholder.test.tsx` passes and asserts the visible title

#### Scenario: Playwright spec verifies the window
- **WHEN** `npm run playwright` is run
- **THEN** `frontend/e2e/placeholder.spec.ts` passes and asserts the title is visible inside the rendered DOM
