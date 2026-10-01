## 1. Local data and schema foundation

- [x] 1.1 Add explicit local app-data configuration for the backend, including isolated development and test data directories.
- [x] 1.2 Pass the production Tauri app-data directory to the bundled sidecar without changing the existing HTTP/Unix-socket transport abstraction.
- [x] 1.3 Add SQLite engine/session lifecycle management with foreign-key enforcement, bounded lock handling, and a testable application lifespan.
- [x] 1.4 Define SQLModel persistence models for workspaces, workspace context, nodes, links, threads, messages, and immutable selection anchors.
- [x] 1.5 Enforce workspace ownership, same-workspace relationships, exactly one unanchored main thread per node, and transactional branch creation in the persistence layer.
- [x] 1.6 Create Alembic migrations for the canonical workspace schema, including a safe pre-migration backup for existing local databases.
- [x] 1.7 Initialize a valid empty workspace and default context for a new data directory, and add validation that refuses invalid persisted data.

## 2. Sidecar lifecycle and workspace APIs

- [x] 2.1 Add lifecycle state that distinguishes process health, pending data initialization, ready data, and initialization failure.
- [x] 2.2 Add and test the readiness endpoint, preserving the existing health endpoint as a lightweight liveness check.
- [x] 2.3 Gate workspace bootstrap and mutation APIs on successful readiness and return diagnosable failures when initialization is unavailable.
- [x] 2.4 Implement revisioned, versioned workspace bootstrap responses from a single consistent persistence transaction.
- [x] 2.5 Implement validated backend commands for workspace graph, thread, message, selection-branch, and context changes so durable writes precede client-state updates.
- [x] 2.6 Add a debounced, independently persisted workspace-context update path for the last open node and graph viewport.
- [x] 2.7 Update the production Tauri sidecar handshake to wait for readiness, terminate failed sidecars safely, and retain clean Unix-socket shutdown behavior.

## 3. Frontend bootstrap and durable interaction

- [x] 3.1 Define Zod schemas and API-client operations for bootstrap, workspace mutations, and workspace-context updates.
- [x] 3.2 Refactor runtime workspace-store initialization to hydrate a validated backend snapshot while retaining fixtures as test factories only.
- [x] 3.3 Update store actions so node, link, thread, message, and anchor changes are applied from successful durable backend results rather than fixture-only mutations.
- [x] 3.4 Add a startup loading, incompatible-schema, and retryable bootstrap-failure experience that blocks workspace mutations until hydration succeeds.
- [x] 3.5 Restore persisted open-node context at hydration and persist navigation/viewport changes without making React Flow derived graph topology durable.
- [x] 3.6 Coordinate the hydration adapter with the active React Flow canvas change so the backend graph snapshot remains its sole graph source of truth.

## 4. Local retrieval index

- [x] 4.1 Add persistence models and migrations for workspace-scoped sources, source metadata, chunks, and durable indexing status.
- [x] 4.2 Create deterministic source chunking with immutable ordered chunks and provenance metadata.
- [x] 4.3 Add SQLite FTS migration and an idempotent projection writer that indexes completed chunks only.
- [x] 4.4 Implement transaction-safe indexing jobs that claim pending work, resume interrupted work after startup, record failures, and avoid duplicate chunks.
- [x] 4.5 Add backend APIs to register source content, inspect indexing state, rebuild the derived local index, and retrieve attributed workspace-scoped passages.
- [x] 4.6 Schedule unfinished indexing after readiness so retrieval work never blocks workspace bootstrap.

## 5. Verification and recovery coverage

- [x] 5.1 Add backend tests for migrations, first launch, rollback-safe migration failure, data validation, ownership isolation, and workspace invariants.
- [x] 5.2 Add API-contract tests for health/readiness separation, bootstrap snapshot consistency, schema-version rejection, and readiness-gated failures.
- [x] 5.3 Add frontend tests for validated hydration, durable mutation results, restored context, loading state, and retry behavior without fixture fallback.
- [x] 5.4 Add Tauri/sidecar integration coverage for the app-data argument, readiness wait, and cleanup on startup failure or window close.
- [x] 5.5 Add retrieval tests for provenance, workspace filtering, FTS result behavior, interrupted indexing recovery, failure reporting, and rebuild safety.
- [x] 5.6 Run the affected backend, frontend, Rust, and browser suites against isolated local data directories and verify restart persistence end to end.
