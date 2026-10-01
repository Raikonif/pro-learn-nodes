## ADDED Requirements

### Requirement: Tauri Dev Is The Canonical End-To-End Run Command
Once Phase 1 lands, `npm run tauri dev` run from the repository root SHALL be the canonical command for opening the full application end-to-end (Tauri window + React frontend + FastAPI backend reachable from the window). The standalone helpers `npm run dev` in `frontend/` and `npm run backend:dev` at the repo root SHALL remain valid for solo frontend or solo backend work, but SHALL NOT be the recommended command when both halves need to talk to each other.

#### Scenario: Tauri dev starts the full app
- **WHEN** a developer runs `npm run tauri dev` from the repository root
- **THEN** a Tauri window opens and the React frontend reaches the FastAPI backend without any additional commands

#### Scenario: Standalone scripts still work for solo work
- **WHEN** a developer runs `npm run dev` in `frontend/` or `npm run backend:dev` at the repo root
- **THEN** that half of the app starts in isolation, exactly as before Phase 1
