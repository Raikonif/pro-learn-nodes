# phase-one-placeholder-ui Specification

## Purpose
TBD - created by archiving change phase-one-tauri-skeleton. Update Purpose after archive.

## Requirements

### Requirement: Backend status indicator reflects /health
The workspace chrome SHALL call `/health` once on mount and SHALL render a green dot with the label "Backend online" when the response validates, and a red dot with the label "Backend offline" otherwise. No polling, no retries — the indicator reflects the first attempt only.

#### Scenario: Backend reachable
- **WHEN** the FastAPI backend is running and `GET /health` returns `{"status": "ok", "backend": "fastapi"}`
- **THEN** the workspace chrome shows a green dot and the label "Backend online"

#### Scenario: Backend unreachable
- **WHEN** the FastAPI backend is not running or `/health` fails
- **THEN** the workspace chrome shows a red dot and the label "Backend offline"
