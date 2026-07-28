## Why

The codebase currently lacks structural convention. Frontend and backend live in a single `src-tauri/` tree with no clear separation of concerns. As the project grows to 15 phases with graph navigation, AI providers, skills, MCP, and practice systems, organizing code by "what it does" rather than "what technology it uses" becomes critical for navigability and long-term maintainability.

Adopting scream architecture for the frontend and layered architecture for the backend establishes clear contracts between layers before feature development begins.

## What Changes

- **Frontend**: Migrate from a technology-based folder structure to a **scream architecture** (feature-first organization under `frontend/src/features/`)
- **Backend**: Migrate from a flat structure to a **layered architecture** (`api/`, `service/`, `repository/`, `models/`, `core/` under `backend/`)
- **Roadmap**: Insert **Phase 0** as a dedicated project-separation milestone before Phase 1, establishing the clean `frontend/` and `backend/` directory split
- **OpenSpec docs**: Update `tech-stack.md` to reflect the architectural patterns; update `roadmap.md` phases; update `mission.md` if scope language needs clarification

## Capabilities

### New Capabilities
- `frontend-scream-architecture`: Feature-first folder organization for the React frontend — `features/`, `shared/`, `app/` as top-level directories
- `backend-layered-architecture`: Strict layer separation for the FastAPI backend — `api/`, `service/`, `repository/`, `models/`, `core/`
- `phase-zero-separation`: A pre-Phase-1 milestone that establishes `frontend/` and `backend/` as sibling directories with independent build/run workflows

### Modified Capabilities
- *(none — no existing capability requirements change)*

## Impact

- **Directories created**: `frontend/`, `backend/`, `frontend/src/features/`, `frontend/src/shared/`, `frontend/src/app/`, `backend/api/`, `backend/service/`, `backend/repository/`, `backend/models/`, `backend/core/`
- **Directory affected**: `src-tauri/` is restructured — `src-tauri/src/` becomes `frontend/src/`, preserving all existing source
- **Build impact**: Frontend build (`npm run dev`, `npm run tauri dev`) runs from `frontend/`; backend dev server (`uvicorn`) runs from `backend/`
- **OpenSpec files updated**: `openspec/tech-stack.md`, `openspec/roadmap.md`, `openspec/mission.md`
