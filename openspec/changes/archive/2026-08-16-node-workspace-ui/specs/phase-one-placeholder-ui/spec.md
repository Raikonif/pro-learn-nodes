## MODIFIED Requirements

### Requirement: Backend status indicator reflects /health
The workspace chrome SHALL call `/health` once on mount and SHALL render a green dot with the label "Backend online" when the response validates, and a red dot with the label "Backend offline" otherwise. No polling, no retries — the indicator reflects the first attempt only.

#### Scenario: Backend reachable
- **WHEN** the FastAPI backend is running and `GET /health` returns `{"status": "ok", "backend": "fastapi"}`
- **THEN** the workspace chrome shows a green dot and the label "Backend online"

#### Scenario: Backend unreachable
- **WHEN** the FastAPI backend is not running or `/health` fails
- **THEN** the workspace chrome shows a red dot and the label "Backend offline"

## REMOVED Requirements

### Requirement: Window renders a Learn Nodes placeholder
**Reason**: The workspace shell replaces the placeholder as the root view. The placeholder existed to prove the Tauri window and the frontend build were wired; the workspace now proves that and renders real navigation. A single placeholder screen and a three-pane workspace cannot both be the visible content on launch.

**Migration**: The root view is now the workspace, specified by `node-workspace-layout`. `frontend/src/app/Placeholder.tsx` is removed. The prohibition this requirement carried on routers, navigation, graphs, and chat UI was scoped to the Phase 1 change and does not carry forward.

### Requirement: Placeholder uses Tailwind utility classes
**Reason**: The screen this constrained no longer exists. The constraint itself is retained and re-stated against the surface that replaces it.

**Migration**: Tailwind-only styling and legibility at 800×600 are required of the workspace by `node-workspace-layout`.

### Requirement: Placeholder has unit and end-to-end tests
**Reason**: The tests named by this requirement target `frontend/src/app/Placeholder.test.tsx` and `frontend/e2e/placeholder.spec.ts`, both of which are removed with the placeholder screen.

**Migration**: Unit and end-to-end coverage move to the workspace surfaces. The end-to-end assertion that the window opens and renders its root view is preserved against the workspace rather than the placeholder title.
