## MODIFIED Requirements

### Requirement: Backend Runs Independently
The backend SHALL be runnable via `uv run uvicorn main:app --port <port> --reload` from within `backend/` without any code from `frontend/` present, where `<port>` defaults to the allocated development backend port. The `backend/` directory SHALL have its own `pyproject.toml` with all Python dependencies declared. The repo-root `package.json` SHALL expose this as `pnpm run backend:dev`, which SHALL resolve the port through allocation rather than hardcoding it.

#### Scenario: Developer runs backend dev server
- **WHEN** a developer runs `uv run uvicorn main:app --port 8009 --reload` from within `backend/`
- **THEN** the FastAPI server starts and responds to `/health` on that port

#### Scenario: Repo-root convenience script
- **WHEN** a developer runs `pnpm run backend:dev` from the repository root
- **THEN** the same server starts on the allocated backend port, because the script changes into `backend/` first and passes the allocated port through

#### Scenario: Default backend port is occupied
- **WHEN** a developer runs `pnpm run backend:dev` while another process holds the default backend port
- **THEN** the server starts on the next available port and reports which port it chose, rather than failing to bind or attaching to the other process
