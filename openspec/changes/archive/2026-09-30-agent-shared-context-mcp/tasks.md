## 0. Preconditions

- [x] 0.1 Confirm `practice-rail-foundation` is applied: its migration is at head and `models/practice.py` and the practice service exist. Stop if not — this change extends its item table.
- [x] 0.2 Record the green baseline: `uv run pytest`, `pnpm test`, `pnpm run typecheck`, `cargo test`, `pnpm exec playwright test`
- [x] 0.3 Add the MCP Python SDK pinned to a 2.x release; build the sidecar from `learn-nodes-backend.spec` with a one-tool server mounted, start the bundled binary, and call the tool over loopback HTTP. Record the version in design.md. If bundling fails, stop and revisit the dependency decision before any other task.

## 1. Listener and credentials

- [x] 1.1 Tests first (`test_context_server_auth.py`): no token → refused with no data; unknown token → refused; token from a previous registry (simulated restart) → refused; request with a browser `Origin` header → refused; valid token → admitted
- [x] 1.2 `service/context_server/credentials.py`: mint, resolve, revoke; scope = `(profile_id, workspace_id, node_id, thread_id, agent_id, agent_name)`; in-memory only
- [x] 1.3 `service/context_server/app.py`: the SDK's streamable-HTTP app behind an ASGI guard (bearer token → scope in a context variable; `Origin` refusal)
- [x] 1.4 Start it in `core/runtime.py`'s lifespan as a second uvicorn server on `127.0.0.1:0`, recording the bound port in `RuntimeState`; stop it on shutdown; test that it is bound to loopback only and gone after lifespan exit

## 2. Handing it to agents

- [x] 2.1 Tests first (in-memory `FakeAgent` recording `mcpServers`): `session/new` and `session/load` receive `learn-nodes` with the loopback URL and a bearer header; loading revokes that thread-and-agent's previous token; a session already open keeps its token
- [x] 2.2 Extend the `Agent` contract and `AcpAgent` so `new_session`/`load_session` accept MCP servers; pass them from `TurnService._session`
- [x] 2.3 The orientation note: prefix it to the first prompt of every new agent session (never loads, never later turns); tests assert exactly once per agent session
- [x] 2.4 Extend the fake ACP agent to honour `mcpServers` by calling a named tool when prompted `mcp:<tool>`; end-to-end test through a real subprocess that the tool call reaches the server with the session's token

## 3. Read tools

- [x] 3.1 Tests first (`test_context_tools.py`): `current_session`, `list_sessions` (archived excluded), `search_sessions`, `read_session` (outline only: message kinds only, each cut to 200 characters, pages of 50 with a cursor, marked partial), `get_messages` (full text, at most 10, other-account ids answered as not found), `get_practice` (items with author, attempts, sandbox code), `recall_memory` (accepted only; by text or topic; superseded and pending never returned); every read of another account's id answers as not found
- [x] 3.2 Implement the handlers over existing services; no repository calls from `service/context_server/`

## 4. Write tools

- [x] 4.1 Tests first: `add_question` adds to the credential's own session only, attributed to its agent, with the practice service's authoring rules (empty prompt, bad options refused with the reason); passing any other session id is not possible by signature; `propose_memory` creates a pending memory with source session and agent, and with a `topic` matching an accepted memory creates a pending revision of it; `set_session_title` succeeds for `provisional`/`auto` and is refused for `topic`/`learner`
- [x] 4.2 Implement the handlers
- [x] 4.3 A test enumerating the registered tools asserts the exact set in design.md (including `add_code_exercise`) — so a tool that updates or removes cannot be added without the test changing

## 4b. Code exercises

- [x] 4b.1 Tests first: authoring a `code_exercise` (empty statement refused; starter code and expected output optional); an exercise's buffer is created from its starter code on first read and is independent of the free buffer and of other exercises; submitting records an attempt with the code, run outcome, truncated output, and `correct` only when an expected output exists (trailing whitespace ignored)
- [x] 4b.2 Migration columns per design "Migration Plan" (item `starter_code`/`expected_output`, attempt `run_outcome`/`run_output`, buffer `item_id` with the unique `(node_id, item_id)` and partial unique free-buffer index); test that existing buffers become free buffers and uniqueness holds for both kinds
- [x] 4b.3 Extend the practice service, repository, and routes: `GET`/`PUT /practice/nodes/{nodeId}/sandbox?itemId=`; `POST /practice/items/{itemId}/attempts` accepting `{ code, runOutcome, runOutput }` for exercises
- [x] 4b.4 File mirror: tests that creating an exercise and saving its buffer write `practice/<short id>-<slug>/README.md` and `solution.py` in the node's directory; that a file modified externally is overwritten on the next save and never read back into the buffer; that another node's directory is never written
- [x] 4b.5 `add_code_exercise` MCP tool with tests (own session only, attributed)

## 4c. Delivery and commands

- [x] 4c.1 Tests first: a delivery bus keyed by `(node_id, thread_id)`; a context-server write during a turn yields `practice.delivered { messageId, tool, itemIds, agentName }` on that turn's stream and records a `practice_delivered` message with `data`; a write for another thread emits nothing on this stream
- [x] 4c.2 `POST /chat/turn` accepts `command` (`code`|`qa`|`quiz`): the prompt carries the fixed instruction, the recorded learner message is the text as typed; a command turn with no delivery records `practice_not_delivered`; tests with the in-memory agent and a fake context-server write
- [x] 4c.3 Frontend: on `practice.delivered`, reload the node's practice, switch the rail's tool, highlight the items; the `practice_delivered` message renders as a link doing the same after a reload; tests
- [x] 4c.4 Frontend: composer `/` suggestions for `/code`, `/qa`, `/quiz`; sending one passes `command`; tests
- [x] 4c.5 Frontend: the Code tool lists the node's exercises (statement, author, attempt count) beside the free sandbox; opening one shows its statement and its own buffer; Submit runs and records an attempt showing outcome, output, and expected-output match; tests
- [x] 4c.6 Playwright with the fake agent honouring `mcp:` prompts: `/quiz …` → the rail switches to Quiz with the new questions highlighted; `/code …` → Code opens the exercise with its starter code; the learner edits and submits → the attempt shows; the agent reads `solution.py` from its directory

## 5. Persistence

- [x] 5.1 Migration after `practice-rail-foundation`'s (with 4b.2's columns in the same revision): `authored_by_agent_id`, `authored_by_name` on the practice item; `data` on `chat_messages`; `memories` table; test existing items stay learner-authored and the downgrade is clean
- [x] 5.2 `models/memory.py`, `repository/memory_repo.py` (profile-scoped), `service/memory_service.py` (propose, propose-as-revision by topic, accept with optional edit — accepting a revision supersedes the previous text in one transaction —, reject, remove, list with history, export as Markdown); tests including cross-account isolation and one accepted memory per topic
- [x] 5.3 Memory routes under the account dependency: list (pending and accepted), accept, reject, edit, remove, export; route tests, including the signed-out enumeration

## 6. Frontend

- [x] 6.1 `features/memory/`: memory API client, panel with pending proposals (source session, agent; accept, edit-and-accept, reject), revisions shown beside the current text, and accepted memories (topic, history of superseded texts, edit, remove, export); reachable from the workspace header; tests
- [x] 6.2 Practice rail: show the author name on agent-written items; tests
- [x] 6.3 Agent settings: one line stating that agents can read the learner's sessions and practice and propose memory through Learn Nodes

## 7. Verification

- [x] 7.1 Real-agent measurement (opt-in, like `real_agents`): with the orientation note and no tool named in the prompt, does each agent call `search_sessions` when asked "what did we cover about X last week?"; and without the note, does it. Record both results in design.md Open Questions
- [x] 7.2 Playwright against the fake agent: an agent adds a question → it appears in the practice rail marked with the agent's name; an agent proposes a memory → it appears pending → accept → a second agent's `recall_memory` returns it
- [x] 7.3 Rebuild the sidecar and bundle; in the built app, confirm a real agent can list the learner's sessions
- [x] 7.4 Update `openspec/roadmap.md`: this change delivers Phase 11's core; Phase 6 remains the client direction
- [x] 7.5 Full suites green
