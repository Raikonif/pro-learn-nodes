## Why

Learn Nodes currently uses fixture-owned workspace data, so sessions, graph branches, threads, messages, and the learner's last location disappear when the desktop app closes. The desktop shell already supervises a local FastAPI sidecar, making this the right time to establish one local, reliable source of truth and a retrieval base without introducing cloud infrastructure or a separate vector database.

## What Changes

- Persist the workspace graph, nodes, directed links, threads, messages, selection anchors, and restorable UI context in a local SQLite database owned exclusively by the FastAPI sidecar.
- Run schema migrations and database validation before the sidecar declares itself ready; preserve the existing lightweight health check separately from readiness.
- Add a versioned bootstrap API that returns one internally consistent workspace snapshot for frontend hydration, including the last open node and graph viewport when available.
- Replace fixture-only runtime initialization with API-backed hydration while retaining fixtures as explicit test data only.
- Establish local retrieval primitives: source records, immutable text chunks, FTS-backed keyword retrieval, and durable indexing status that can resume safely after an interrupted start.
- Define retrieval as a rebuildable projection of canonical workspace/source data; semantic embeddings, hosted model providers, and external vector databases remain out of scope for this change.

## Capabilities

### New Capabilities

- `local-workspace-persistence`: Durable, local storage and integrity rules for the workspace graph, conversations, anchors, and restorable workspace context.
- `workspace-bootstrap`: A single validated API snapshot and frontend hydration lifecycle that brings a desktop session to a consistent usable state.
- `local-retrieval-index`: Local source chunking, resumable indexing state, and FTS-backed retrieval over indexed source content.

### Modified Capabilities

- `fastapi-sidecar`: Require the production sidecar to complete local-data initialization and report readiness before Tauri treats it as available to the frontend.

## Impact

- Affects the FastAPI application lifecycle, route structure, configuration, and the production sidecar startup handshake.
- Adds SQLModel/Alembic models and migrations for a local SQLite database; those dependencies already exist in `backend/pyproject.toml`.
- Replaces the frontend's runtime fixture initialization with an API-backed repository/hydration path while preserving the Zustand store as the interactive client cache.
- Adds SQLite FTS support and a small, local indexing worker or queue; no network service, cloud account, embedding model, or separate vector-store dependency is introduced.
- Requires migration, API-contract, frontend-hydration, and startup-recovery test coverage.
