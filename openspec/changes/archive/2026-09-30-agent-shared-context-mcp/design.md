## Context

The application is the only party that sees everything a learner does: every session with every agent, every practice attempt, every archived line of study. Agents see only the conversation they are running. `local-sessions-and-history` made the local record the identity and agents interchangeable executors of it; this change lets those executors read the record — and add to it — through a channel the application controls.

## Spike results (2026-10-01)

A throwaway MCP server (streamable HTTP, `mcp` 1.x `FastMCP`, stateless) with one read tool and one write tool, passed to each agent in `session/new` as `{"type": "http", "name": "learn-nodes", "url": …, "headers": [{"name": "Authorization", "value": "Bearer …"}]}`:

| | codex-acp 2.0.1 | claude-agent-acp 0.84.0 |
|---|---|---|
| `mcpCapabilities` | `http` | `http`, `sse` |
| Accepts `mcpServers` in `session/new` | yes | yes |
| Calls a read tool | yes (`mcp.learn-nodes.get_secret_word`) | yes (`mcp__learn-nodes__get_secret_word`, after a `ToolSearch`) |
| Calls a write tool | yes | yes |
| Sends `session/request_permission` for MCP tools | **no** | **no** |
| Forwards the `Authorization` header | yes | yes |

Also found: the Python SDK is now **2.x**, where `FastMCP` became `MCPServer` and other APIs moved. The spike pinned `<2`.

Codex emitted a second tool call, `Guardian Review`, after each MCP call — its own internal review step. It is recorded as tool activity like any other.

## Goals / Non-Goals

**Goals**

- One view of the learner's local material, available to every agent through the same tools.
- No new way to lose or corrupt anything the learner made.
- Nothing reachable across accounts, nothing reachable from off the device, nothing reachable without a credential the application issued.

**Non-Goals**

- Agents running code in the sandbox, or editing its buffer.
- Grading free-text answers.
- Injecting memory into prompts. Agents read it through a tool.
- Consuming external MCP servers (roadmap Phase 6 — the opposite direction).

## Decisions

### Loopback HTTP, not the Unix socket and not stdio

The production backend listens on a Unix socket that only the Tauri host reaches; an agent cannot connect to it. Two transports reach an agent:

- **HTTP on `127.0.0.1`, an ephemeral port** — measured working with both agents.
- **stdio** — every ACP agent must support it, but it needs a bridge process per session that relays to the backend, and it was not measured.

HTTP is chosen because it is the one proven. The listener is a second in-process uvicorn server, started in the lifespan beside the agent supervisor and stopped with it, bound to `127.0.0.1` only, on a port the OS assigns at startup. The same wiring serves development and the built app.

A loopback port is reachable by every process on the device. Three things make that acceptable: every call needs a bearer token (below); requests carrying a browser `Origin` header are refused, which closes DNS-rebinding from a web page — the MCP transport specification's own recommendation; and nothing reachable through it is destructive.

### A credential per agent session, held only in memory

When `service/agent/sessions.py` opens or loads a session, it mints a token (`secrets.token_urlsafe(32)`) bound to a scope — `(profile_id, workspace_id, node_id, thread_id, agent registration)` — and passes the server's URL and the token in `mcpServers`. The registry lives in process memory: a restart invalidates every token, and each session receives a fresh one when it is loaded again, because `session/load` takes `mcpServers` too. Loading a session revokes that thread-and-agent's previous token.

A credential is the only source of scope. No tool takes an account, a workspace, or — for writes — a session id from the caller; the same rule `api/dependencies/auth.py` enforces for HTTP routes, applied to the second entrance.

### The tool set, and why every write is an addition

| Tool | Reads / writes | Scope |
|---|---|---|
| `current_session()` | read | its session: title, mode, agent |
| `list_sessions(limit)` | read | the account's unarchived sessions, most recent first |
| `search_sessions(query)` | read | previews: as `GET /workspace/sessions/search`, archived excluded |
| `read_session(session_id, cursor?)` | read | an **outline**: messages (`kind = 'message'`) newest first, each cut to 200 characters, with ids; one bounded page plus a `next` cursor |
| `get_messages(message_ids)` | read | the **full text** of up to 10 named messages, each within the account |
| `get_practice(session_id)` | read | items with author, attempts, sandbox code |
| `recall_memory(query?, topic?)` | read | the account's **accepted** memories — previews when many, matched by text or topic |
| `add_question(prompt, kind, options?, reference_answer?)` | adds | a free-response or multiple-choice item on its **own** session, authored by its agent |
| `add_code_exercise(prompt, starter_code, expected_output?)` | adds | a code exercise on its **own** session, authored by its agent |
| `propose_memory(fact, topic?)` | adds | a **pending** memory, or a pending **revision** when `topic` names an accepted memory |
| `set_session_title(title)` | sets once | its own session, only while `title_source` is `provisional` or `auto` |

Agents do not ask before calling MCP tools (measured), so the server's rules are the only control. No tool updates, overwrites, or removes anything. The one field a tool sets — the title — is one the application would otherwise have derived automatically, and a learner's or topic title is refused.

Handlers call existing services (`service/workspace.py`, the practice service from `practice-rail-foundation`, a new memory service). The MCP layer is presentation: it sits where `api/` does and follows the same `→ service → repository` rule.

### Agents are told the tools exist, once, when a session is created

In the spike every prompt named the tool to use, and Claude still had to search for it. An agent left alone may never call a tool it was not told about.

A new agent session's first prompt therefore begins with a short fixed note: that it is running inside Learn Nodes, which tools exist, and when they help (to see what the learner did elsewhere, to add practice, to propose memory). The note is constant, sent once per agent session and never on later turns.

This is a narrow exception to "inference-time skill merging is unavailable on agent backends". That rule is about the application assembling per-turn context, which a session-stateful agent defeats. A single, constant orientation at session start assembles nothing. It is also measured: the tasks include a check that agents use the tools unprompted with the note, and do not without it.

### Reading is progressive, as Engram reads its memory

Borrowed from [Engram](https://github.com/Gentleman-Programming/engram), whose agents find memory through `mem_search` (previews) → `mem_timeline` (context) → `mem_get_observation` (full record). An agent's context is the scarce resource: a `read_session` that returned whole transcripts would spend it on material the agent mostly does not need, and would make a long-running learner's oldest sessions the costliest to consult.

So every read has a ceiling and says when it was cut: search returns snippets; `read_session` returns an outline — ids, roles, and the first 200 characters of each message, in pages of 50 with a cursor; `get_messages` returns full text for at most ten ids. The orientation note tells agents to go in that order.

### Authorship is recorded on the item, not inferred from the log

`practice-rail-foundation`'s item gains `authored_by_agent_id` (null for the learner) and `authored_by_name` — a snapshot, so an item still names its author after the registration is removed. The practice rail shows the name. Attempts are untouched: an agent's question is answered exactly like a learner's.

### Memory is a proposal until the learner decides

A `memories` table: `profile_id`, `text`, `topic` (nullable), `status` (`pending`, `accepted`, `rejected`, `removed`, `superseded`), `revises_id` (nullable — the accepted memory a pending revision would replace), `proposed_by_name`, `source_node_id`, `created_at`, `decided_at`. `recall_memory` returns only `accepted`.

**Topics make memory evolve rather than accumulate** — the other idea taken from Engram, its `topic_key`. Without one, "knows Haskell is lazy" and, weeks later, "understands thunks and deferred evaluation" become two memories that overlap and can contradict. A proposal whose `topic` matches an accepted memory is stored as a pending revision (`revises_id` set) and shown beside the current text. Accepting it marks the previous row `superseded` — kept, and shown as that memory's history — and the revision `accepted`, in one transaction. A unique partial index allows one `accepted` memory per `(profile_id, topic)`. Engram lets its agents update memory directly (`mem_update`); here a revision is a proposal like any other, because agents do not ask before calling tools and the learner decides what is remembered. Rejected and removed rows are kept rather than deleted, so a fact the learner declined is not simply proposed again with no record that it was declined. Scoped by profile, per roadmap Phase 11 ("memories are per-learner, not per-node").

The panel lists pending proposals with their source session and agent, and accepted memories with edit, remove, and export as Markdown.

### The SDK is adopted after a bundling check

The official MCP Python SDK provides the streamable HTTP transport, and a hand-rolled server is a worse trade here than a hand-rolled ACP client was. MCP's server-side transport — session headers, content negotiation, SSE responses — is larger than the ACP subset the client needed. It is pinned to a 2.x release. The first task builds the sidecar with it and calls a tool through the bundled binary, before any code depends on it — the check `acp-agent-backend` made for its own dependency question.

*Verified 2026-10-02:* `mcp==2.2.0`. A probe that starts the app's lifespan, mints a credential, and calls the server over loopback was built with PyInstaller from the backend's environment and run as a binary: `tools/list` and a tool call answered 200, a call without a credential 401, and a call with a browser `Origin` 403. The SDK's own OAuth-oriented auth (`AuthSettings` needs an issuer) was not used — the bearer guard is ours — and its DNS-rebinding host check is disabled in favour of refusing any `Origin`, since it needs the port before the OS assigns it.

### Delivery: the context server tells the turn, the turn tells the window

An agent calls `add_question` or `add_code_exercise` in the middle of a turn, on a different connection from the one streaming that turn to the window. The context server publishes each successful write to an in-process delivery bus keyed by `(node_id, thread_id)` — both known from the credential. `TurnService` subscribes for the duration of a turn and, for each delivery, records a conversation message of kind `practice_delivered` (content: *"Codex sent 3 questions to Quiz"*; `data`: the tool and the item ids) and yields a `practice.delivered { messageId, tool, itemIds, agentName }` event on the turn's stream.

The frontend, on that event, reloads the node's practice, switches the rail to `tool`, and highlights `itemIds`. The recorded message renders as a link that does the same later — after a restart it is the only way back to what was delivered, so it carries the ids rather than relying on the stream having been seen. `chat_messages` gains a nullable JSON `data` column for it; `kind` already exists.

A delivery for a session not on screen changes nothing in the window: the event belongs to that session's turn stream, and only the open session's stream is being read.

### Commands are an instruction the application adds, and a check it makes

`/code`, `/qa`, and `/quiz` are parsed in the composer and sent as `POST /chat/turn { threadId, text, command }`. The backend prefixes the prompt with a fixed instruction per command — for `/quiz`: *create these as multiple-choice questions with the learn-nodes `add_question` tool, and do not answer them in the conversation* — and records the learner's message as they typed it, without the prefix. When a command turn ends with no delivery on the bus, the turn service records a `practice_not_delivered` notice, so a model that answered in text anyway is visible rather than silent.

Plain words work through the orientation note, which tells the agent that the rail exists and what each tool is for; they are not checked, because the application cannot tell a request for practice from a question about it.

These three commands are fixed here; `command-palette-and-skill-commands` generalizes the composer's `/` menu later and should adopt them rather than redefine them.

### Code exercises: an item, a buffer per exercise, an attempt that keeps the run

- **Item**: kind `code_exercise`; the practice item gains `starter_code` and `expected_output` (both nullable, used only by this kind). The authoring rules refuse an empty statement; starter code may be empty.
- **Buffer**: `sandbox_buffers` gains a nullable `item_id`. The free buffer is `(node, NULL)`, an exercise's is `(node, item)`, each unique — the free buffer's uniqueness by a partial index, since SQLite treats NULLs as distinct in a plain unique constraint. An exercise's buffer is created from its starter code when first opened. Only `PUT` from the frontend writes buffers; no tool does.
- **Attempt**: Submit runs the buffer and records an attempt with `response` = the code, plus `run_outcome` and `run_output` (truncated to 20,000 characters). `correct` is set only when the exercise has an expected output: whether the run completed and its stdout, trailing whitespace trimmed, equals it. No other judgement is computed; review is the agent's, in the conversation.

### The agent reads exercises as files, and the files are a mirror

For each exercise the practice service keeps `practice/<short id>-<slug>/README.md` (the statement, and the expected output if any) and `solution.py` (the learner's buffer) in the node's directory — the agent's working directory from `acp-agent-backend`. Files are written when an exercise is created and on every buffer save. The buffer is the record and the files are its projection: anything written to them from outside is overwritten on the learner's next edit and never read back. Reading inside the node's directory is the automatic, unasked case in `acp-agent-permissions-and-branching`'s policy, so reviewing a solution needs no prompt.

## Interfaces

The HTTP and stream contract the frontend builds against (fixed 2026-10-02). camelCase JSON; every route behind the account dependency; another account's resource is 404.

### Turn stream and messages

- `POST /chat/turn` accepts an optional `command: "code" | "qa" | "quiz"`. The learner message is recorded as typed, without the instruction the backend adds.
- New stream event `practice.delivered { messageId, tool: "code" | "qa" | "quiz", itemIds: string[], agentName }`, emitted once per delivery during the turn.
- Bootstrap messages gain `data: object | null`. Two new `kind`s, both `role: "agent"`:
  - `practice_delivered` — `content` e.g. *"Codex sent 3 questions to Quiz"*, `data: { tool, itemIds }`.
  - `practice_not_delivered` — `content` stating nothing was delivered, `data: { tool }`.

### Practice additions

- `Item` gains `kind: "code_exercise"`, `starterCode: string | null`, `expectedOutput: string | null`, and `authoredBy: { agentId: string | null, name: string } | null` — `null` for the learner.
- `Attempt` gains `runOutcome: "completed" | "error" | "stopped" | "timed_out" | null` and `runOutput: string | null`. For a code exercise, `response` is the submitted code and `correct` is set only when the exercise has an expected output.
- `POST /practice/nodes/{nodeId}/items` accepts `{ kind: "code_exercise", prompt, starterCode?, expectedOutput? }`.
- `POST /practice/items/{itemId}/attempts` accepts `{ code, runOutcome, runOutput }` for a code exercise.
- `GET` / `PUT /practice/nodes/{nodeId}/sandbox?itemId=<id>` read and write that exercise's buffer; a never-saved exercise buffer reads as its starter code with `updatedAt: null`. Without `itemId`, the free buffer, unchanged.

### Memory

- `Memory = { id, text, topic: string | null, status: "pending" | "accepted", proposedBy: string, sourceNodeId: string | null, sourceTitle: string | null, createdAt, decidedAt: string | null, revises: { id, text } | null, history: { text, decidedAt }[] }` — `revises` set on a pending revision; `history` on an accepted memory, oldest first.
- `GET /memory` → `{ pending: Memory[], accepted: Memory[] }`.
- `POST /memory/{id}/accept` `{ text? }` — `text` accepts with an edit. `POST /memory/{id}/reject`.
- `PUT /memory/{id}` `{ text }` — the learner edits an accepted memory (its previous text joins its history). `DELETE /memory/{id}` — the learner removes an accepted memory.
- `GET /memory/export` → `text/markdown`.

## Risks / Trade-offs

- **Agents act without asking.** The server's surface is the whole defence: every write is additive, scoped to the credential's session, and attributed. Adding a destructive tool later would need a permission design first; the spec states that nothing may update or remove.
- **A loopback port is visible to local processes.** Mitigated by tokens, `Origin` refusal, and a read surface limited to one account. A process running as the same user can already read the SQLite file directly, so the token protects against confusion more than against a determined local attacker — stated, not overclaimed.
- **Reading other sessions is powerful.** An agent in one session can read what was said in another. That is the point of the change, but a learner may not expect it; the memory panel and a line in agent settings say so.
- **SDK 2.x is new.** Pinned, bundled, and checked first; the tool handlers are thin enough that swapping the transport means touching one module.
- **A model may answer in the chat anyway.** Commands add an instruction and check the result; the `practice_not_delivered` notice is the honest fallback, and task 7.1's measurement covers plain-words requests.
- **Files an agent can write.** The mirror lives where the agent can write, so it is never read back — the buffer is the only source. An agent "fixing" the learner's solution in the file changes nothing the learner sees.
- **Sequencing.** This depends on `practice-rail-foundation` being applied. Its item table is the one gaining the authorship columns.

## Migration Plan

One revision after `practice-rail-foundation`'s: add `authored_by_agent_id`, `authored_by_name`, `starter_code`, and `expected_output` (nullable) to the practice item table — existing items are the learner's; add `run_outcome` and `run_output` (nullable) to attempts; add a nullable `item_id` to `sandbox_buffers`, replacing its per-node unique constraint with unique `(node_id, item_id)` plus a partial unique index on `node_id` where `item_id IS NULL`; add a nullable JSON `data` column to `chat_messages`; create `memories`. Existing rows keep their meaning: every existing buffer is its node's free buffer.

## Open Questions

- *Measured 2026-10-03 (`tests/test_real_agents_context.py`, codex-acp 2.0.1 and claude-agent-acp 0.84.0):* asked "what did we cover about Haskell last week?" in a new session, **both agents searched the learner's sessions with and without the orientation note** — the tool descriptions alone sufficed for a question that names past work. Both followed the progressive order on their own (`search_sessions` → `read_session`, Codex then `get_messages`). Given `/quiz two quick questions…`, **both called `add_question` twice and delivered two multiple-choice items to Quiz**, replying with a pointer rather than the questions. The note stays: it is what makes "send it to Code" and memory proposals discoverable, which a question about the past does not exercise.
- Should reading other sessions be something the learner can turn off per session ("keep this one private")? Not in this change; worth deciding once the feature is in use.
