## Context

See proposal.md for motivation. The production Tauri shell already starts a FastAPI sidecar over a Unix socket and waits for a health response, while the frontend's Zustand store is populated from fixture data. The backend already includes SQLModel and Alembic dependencies but has no workspace persistence or database startup lifecycle.

The design must preserve the existing frontend API-client transport abstraction: feature code continues to call the API rather than choosing HTTP or Unix-socket transport. It must also preserve the domain rules in the node-chat and selection-branching specifications, particularly durable anchors and one main thread per node.

## Goals / Non-Goals

**Goals:**

- Make a locally persisted workspace the only runtime authority, with the frontend store acting as a validated interactive cache.
- Make sidecar readiness mean the database is migrated, validated, and able to serve a consistent bootstrap snapshot.
- Provide useful local retrieval with durable indexing recovery while keeping indexing off the startup critical path.
- Keep every durable record private to the local app data directory and accessible through the backend boundary only.

**Non-Goals:**

- Multi-device sync, user accounts, collaboration, or a hosted backend.
- An embedding model, semantic vector search, a cloud retrieval provider, or an external vector database.
- A learner-facing source-import workflow or generated-answer/RAG orchestration UI; this change establishes the backend foundation those features will use.
- Persisting React Flow's derived visual graph model or making it a second graph authority.

## Decisions

### Store the database in an explicit Tauri-owned app-data directory

Tauri will resolve a per-user application-data directory and pass it to the production sidecar as an explicit runtime argument. The sidecar will derive the SQLite database, migration backup, and retrieval working paths from that directory; it will not depend on its working directory, the application bundle, or a development directory. Development will use an explicit configurable local data directory so tests can isolate their databases.

SQLite is the right first durable store because the application is single-user, local-first, offline-capable, and already has SQLModel/Alembic available. The connection will enable foreign-key enforcement and use a single-writer-friendly configuration appropriate for a local sidecar.

Alternative considered: PostgreSQL or a cloud database. Rejected because they add deployment, account, network, and recovery concerns before the product needs sharing or synchronization.

### Model the workspace as normalized canonical data

The relational model will use a workspace identifier on all tenant-scoped records and enforce these ownership relationships:

```text
Workspace
 ├─ WorkspaceContext       (last-open node, viewport)
 ├─ Node
 │   ├─ Thread
 │   │   └─ Message
 │   └─ NodeLink ───────────────▶ Node
 │        └─ SelectionAnchor
 └─ Source
     └─ SourceChunk ────────────▶ local FTS index
```

Node links and spawned threads can each reference an immutable selection-anchor record; a node's main thread has no anchor. A partial uniqueness constraint and service-level validation will ensure exactly one main thread per node. Composite ownership checks will reject cross-workspace links, threads, messages, anchors, sources, and chunks. Creating a branch will persist its node/link/main-thread or thread/anchor records inside one transaction.

The UI's `WorkspaceGraph` remains the frontend domain representation; the API maps canonical persistence records into that shape. React Flow positions remain derived presentation data, while the viewport is the only graph-view state persisted as user context.

Alternative considered: serialize the entire Zustand store as one JSON document. Rejected because it makes relational invariants, partial updates, source retrieval, and future migrations difficult to validate.

### Use revisioned snapshots and API-backed hydration

The backend will expose a versioned bootstrap resource that reads workspace records and context in a single read transaction, returning a schema version and monotonically increasing workspace revision. Every successful graph, conversation, anchor, source, or context mutation increments the workspace revision in its transaction.

The frontend will validate the snapshot through Zod, replace the fixture-created runtime state only after validation, and keep a distinct loading/retry state. It will save navigation context through the backend with a small, debounced write path; it will not write directly to SQLite or use fixtures as a production fallback.

Alternative considered: load nodes, threads, messages, and preferences through several independent requests. Rejected because a restart can otherwise hydrate a graph revision that does not match its messages, links, or selected node.

### Define readiness as data availability, not indexing completion

The FastAPI lifespan will run this ordered startup sequence:

```text
Tauri launches sidecar
        │
        ▼
open local data directory → migrate schema → validate data → initialize empty workspace
        │                                                    │
        ├─ failure: /ready stays unsuccessful                 └─ success
        ▼                                                            │
process health available                                      mark /ready successful
                                                                     │
                                                                     ▼
                                                        schedule unfinished indexing
                                                                     │
                                                                     ▼
                                                        frontend requests bootstrap
```

`/health` remains a cheap liveness response. `/ready` succeeds only after migration, validation, and empty-workspace initialization complete; bootstrap is gated by the same ready state. Tauri's production handshake changes to wait for `/ready`. Retrieval work begins after readiness and exposes durable status, so it can neither delay the first interactive workspace nor make the data snapshot inconsistent.

Alternative considered: retain a single health endpoint and perform migrations after the UI loads. Rejected because it permits the frontend to observe an unusable or partly migrated database.

### Build a rebuildable FTS retrieval projection

Canonical source text and metadata will be stored in ordinary SQLite tables. A deterministic chunking service will create ordered, immutable chunks, and an SQLite FTS table will index the completed chunks. Indexing state is recorded per source as pending, running, completed, or failed, with an error description where applicable.

An indexing job claims pending or interrupted work transactionally, writes chunks and FTS entries idempotently, then marks the source complete. Startup resets abandoned running work to a retryable state; a rebuild clears only derived chunks and FTS entries, never workspace graph or conversation data. Query responses include source and location provenance and are filtered by workspace before being returned.

Alternative considered: introduce embeddings and a vector database now. Rejected because keyword retrieval establishes source ownership, provenance, chunking, lifecycle, and recovery first; embedding choice can be added later as another projection without changing canonical data.

### Keep migration failure recoverable

Before applying a schema migration to an existing SQLite database, the sidecar will create a timestamped local backup in the app-data directory. A migration or validation failure will prevent readiness and preserve diagnostic detail; it will not silently reset or overwrite learner data. Development and automated tests will use isolated temporary data directories rather than an operator's real app data.

Alternative considered: automatically delete and recreate a failed database. Rejected because lost learning conversations and graph history are unacceptable.

## Risks / Trade-offs

- [An old or damaged database cannot migrate] → Preserve the original and backup, keep readiness unavailable, and surface a recoverable diagnostic rather than resetting data.
- [SQLite is locked by a stale or competing process] → Tauri owns one production sidecar, the backend uses bounded connection timeouts, and readiness reports the failure rather than serving partial data.
- [Bootstrap payloads grow with long conversations] → Start with one full workspace snapshot for consistency; add paged message history only in a future change when measured data requires it.
- [Indexing can consume time after startup] → Run it after readiness with resumable status, bounded batches, and query only completed chunks.
- [Fixture-dependent UI tests accidentally exercise production initialization] → Keep fixtures as explicit test factories and provide test bootstrap/database fixtures that create isolated persisted data.
- [Tauri-to-sidecar app-data argument changes production packaging] → Add integration coverage for the packaged-sidecar argument and retain the existing Unix-socket transport boundary.

## Migration Plan

1. Add database configuration, lifecycle management, canonical models, Alembic baseline, and isolated test database setup.
2. Add readiness, bootstrap, and workspace-context APIs; change the production Tauri handshake from health to readiness while retaining liveness health.
3. Add frontend validation, loading/retry presentation, hydration, and context persistence; retain fixtures only for tests and development data factories.
4. Add sources, chunking, FTS projection, indexing-state recovery, and retrieval APIs after the canonical workspace path is verified.
5. Ship with an empty initialized workspace for new users. Existing development fixture data is not migrated because it has never been durable user data.

Rollback before release consists of restoring the prior application build; the local SQLite database and its pre-migration backup remain intact. After a release that writes the new schema, rollback code must not open the newer database; recovery uses the pre-migration backup or a forward-compatible repair release rather than destructive downgrade.

## Open Questions

- Which user-facing source-import formats and metadata fields should the first retrieval UI support? This does not change the storage, indexing, or bootstrap foundation and can be specified in a later ingestion change.
- When semantic retrieval is introduced, should embeddings be generated locally or through an opt-in provider? Either choice can use the canonical source/chunk model and remain a separate derived index.
