## 0. Preconditions

- [x] 0.1 Record the green baseline: `uv run pytest` in `backend/`, `pnpm test` and `pnpm run typecheck` in `frontend/`, `cargo test` in `src-tauri/`
- [x] 0.2 Confirm `acp-agent-backend` is applied (its `agent_registrations` migration is at head and `service/agent/sessions.py` exists); this change rewrites its session mapping

## 1. Migration

- [x] 1.1 Write failing `backend/tests/test_session_migration.py` against a populated database at the `acp-agent-backend` head: `last_activity_at` backfilled to the later of `last_opened_at` and the newest message; existing nodes `title_source = 'topic'` and `archived_at` null; each thread's `(agent_id, agent_session_id)` carried into `agent_sessions` with `synced_through` = its newest message; `message_fts` finds an existing message; foreign keys intact after the `chat_threads` rebuild (`PRAGMA foreign_key_list`)
- [x] 1.2 Add model fields: `WorkspaceNodeRecord.last_activity_at`, `title_source`, `archived_at`; new `AgentSessionRecord` (`thread_id`, `agent_id`, `session_id`, `synced_through`, unique `(thread_id, agent_id)`); remove `agent_id`/`agent_session_id` from `ChatThreadRecord`
- [x] 1.3 Write the Alembic revision per design "Migration Plan", including the `message_fts` table, its population, and insert/update/delete triggers limited to `kind = 'message'`
- [x] 1.4 Downgrade test: data intact, one agent session per thread restored (most recently synced wins)

## 2. Activity and titles

- [x] 2.1 Tests first: opening a node (`update_context` naming it) and recording a message (every writer: `append_message` and the turn service) each move `last_activity_at`; order survives a new engine
- [x] 2.2 Implement the bumps in `service/workspace.py` and `service/agent/sessions.py`
- [x] 2.3 Tests first: `create_root_node` with no title → `"New session"`, `provisional`; first learner message → derived title (whitespace collapsed, ≤60 chars at a word boundary), `auto`; `topic` and `learner` titles never overwritten
- [x] 2.4 Implement title derivation where the first learner message is recorded; make `RootNodeInput.title` optional
- [x] 2.5 `rename_node` (refuses empty) and `PUT /workspace/nodes/{id}/title`, with route tests including another account's node → 404
- [x] 2.6 Serialize `lastActivityAt` and `titleSource` in bootstrap

## 3. Archive

- [x] 3.1 Tests first: archiving excludes the node and every link touching it from bootstrap, keeps its threads, messages, and agent sessions; its children stay in bootstrap; restoring brings it back in activity order; another account's node → 404
- [x] 3.2 Implement `archive_node` / `restore_node` and the single bootstrap filter; `POST /workspace/nodes/{id}/archive` and `/restore`
- [x] 3.3 Verify no route offers deletion from the history (test enumerating the workspace router for a DELETE on nodes)

## 4. Content search

- [x] 4.1 Tests first (`test_session_search.py`): a phrase only in a message finds its node with `threadId`, `messageId`, and a snippet; a title match returns `messageId: null`; a message written by the streaming path is findable after the turn; archived excluded unless `includeArchived`; another account's content never returned; empty and punctuation-only queries return nothing without error
- [x] 4.2 Implement `repository/session_repo.py` search (quoted ANDed terms, `workspace_id` filter, `bm25`, `snippet()`) and `GET /workspace/sessions/search`
- [x] 4.3 Measure the update trigger during a 2,000-chunk streamed turn against the fake agent; if the turn slows by more than 10%, restrict indexing of agent messages to when their outcome is set, and record the measurement in design.md

## 5. Agent sessions per agent

- [x] 5.1 Tests first in `test_agent_sessions.py` (in-memory `FakeAgent`): A → B → A continues A's own session with no seam, and A's prompt carries B's exchange as catch-up and ends with the new message; consecutive turns on one agent carry only the new message; a first turn on a new agent with prior history replays with a seam; a failed load falls back to replay; removing an agent leaves the session readable and continuable on another
- [x] 5.2 Rewrite `TurnService._session` over `agent_sessions`: resolve (thread, agent) → continue / load / new+replay; compute catch-up from `synced_through`; advance `synced_through` to the reply's `created_at` at turn end in every outcome
- [x] 5.3 Update `test_agent_end_to_end.py`: register two fake agents, switch between them across an app restart, assert the second return loads without a seam
- [x] 5.4 Update `acp-agent-backend`'s design.md Migration Plan note on thread-held sessions to point here

## 6. Frontend: creating sessions

- [x] 6.1 `workspace-api.ts`: `createRootNode({ title?, mode? })`, `renameNode`, `archiveNode`, `restoreNode`, `searchSessions`; types gain `lastActivityAt`, `titleSource`; tests
- [x] 6.2 `workspace-store.ts`: actions for the above that open the created node and focus its composer; tests
- [x] 6.3 `features/study-launcher/`: a quick-start control and a detailed-start dialog (topic + mode, dismissible without side effects); component tests
- [x] 6.4 Empty workspace: the center region shows both starts instead of an empty graph when the account has no sessions; component test
- [x] 6.5 Place the quick-start control in the left-rail header as well (design Open Questions); verify legibility at 800×600

## 7. Frontend: history

- [x] 7.1 A pure `groupSessionsByDay(nodes, now)` in `features/graph-navigation/` with tests for each group boundary in the local timezone, and empty groups omitted
- [x] 7.2 Rebuild `RecentsRail` as the session history: groups, title, last-message preview, last agent name (from `GET /agents`), archive action; no threads as entries; tests
- [x] 7.3 Inline rename in the history entry; tests
- [x] 7.4 Search input queries `searchSessions` (debounced); results show snippets; "include archived" toggle; an archived result offers Restore; tests
- [x] 7.5 Activating a message result opens its node and thread and scrolls the message into view with a brief highlight; tests

## 8. Verification

- [x] 8.1 Playwright: fresh account → empty state → quick start → send (fake agent) → title derived → appears under Today → search a phrase from the reply → open at the message → archive → gone from history and graph → search with archived → restore
- [x] 8.2 Playwright: detailed start with a topic and mode → the session carries both
- [x] 8.3 Update `node-projects-and-archive`: note in its README and tasks that node-level archive (`archived_at`, the bootstrap filter) landed here, turning its node-archive tasks into verifications
- [x] 8.4 Rebuild the sidecar from the spec file and the Tauri bundle; confirm in the built app that a quick session can be created and written in
- [x] 8.5 Full suites green: `uv run pytest`, `pnpm test`, `pnpm run typecheck`, `cargo test`, `pnpm exec playwright test`
