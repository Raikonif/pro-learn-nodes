# Roadmap

Phases 0–7 (with 3a, 3b, 5a) build the foundation; 8–15 are where the differentiated experience emerges. Each phase is independently shippable and ends with something you can run and demo.

Lettered phases were inserted after the original numbering. They are not smaller — they are later-discovered prerequisites of the phases they precede: accounts must exist before per-learner data does, projects before a graph grows past one person's memory of it, and a command surface before skills are reachable rather than merely configured.

---

## Phase 0 — Project Separation
*Goal: Clean structural separation between frontend and backend before any feature code is written.*

- `frontend/` created at repo root — React/Vite app, runs via `npm run dev`
- `backend/` created at repo root — FastAPI app (uv-managed), runs via `cd backend && uv run uvicorn main:app --port 8000 --reload`, wired as `npm run backend:dev` at the repo root
- `frontend/src/` is the React source root; `backend/` is the FastAPI source root
- `frontend/` and `backend/` build and run independently — neither depends on the other being present
- Skeleton directories only (`features/`, `shared/`, `app/` for frontend; `api/`, `service/`, `repository/`, `models/`, `core/` for backend). The sole live endpoint is `/health`, which moves from `main.py` into `api/routes/health.py` to prove the API layer is wired.
- `src-tauri/` contains only Tauri/Rust configuration — no React source mixed in

**Demo:** `npm run dev` in `frontend/` and `npm run backend:dev` from the repo root both start successfully and independently.

---

## Phase 1 — Project Skeleton
*Goal: Tauri window + FastAPI sidecar, talking to each other.*

- Scaffold Tauri 2 app: React 19 + Vite + TS + Tailwind
- Scaffold FastAPI backend (uv-managed): `/health` endpoint
- Tauri ↔ FastAPI IPC: HTTP on localhost in dev; Unix socket in production
- App renders "Learn Nodes" placeholder
- `npm run tauri dev` and `npm run tauri build` both work end-to-end

**Demo:** `npm run tauri dev` → window opens → shows placeholder.

---

## Phase 2 — Data Model & Migrations
*Goal: The session tree is defined in code and migrations.*

- Define SQLModel schemas: `Node`, `Link`, `FileAttachment`, `Tag`, `ChatMessage`, `Correction`, `CompactionStep`, `PracticeAttempt`
- `Node.parent_id` (nullable FK to Node) — supports tree and DAG
- `Node.fork_point` (int) — turn in parent where branching occurred
- Alembic migrations generated from SQLModel
- Seed script: 5 nodes forming a tree (1 root + 2 children + 1 grandchild) with sample chat history
- Inspect `.db` in sqlite3 CLI — verify parent-child relationships

**Demo:** sqlite3 CLI shows a session tree you can walk with SQL.

---

## Phase 3 — Node CRUD + File Upload + Graph View
*Goal: Create nodes, attach files, navigate the graph.*

- FastAPI CRUD routes for nodes (create / get / list / update / delete)
- React UI: node list, node detail, create/edit form
- Node body as Markdown with YAML frontmatter (stored as TEXT in SQLite)
- File upload endpoint: text/PDF (PyMuPDF text extraction) and image (stored, path recorded)
- BTP (Back-To-Previous) SSE event emitted when file processing completes
- Graph view (React Flow / `@xyflow/react`): card-based canvas with directed branch edges, viewport controls, and a minimap — **delivered** by the `adopt-react-flow-node-canvas` change; this phase replaces its fixtures with real data
- Three nav tabs: Outline (tree), Canvas (spatial), Timeline
- Recent nodes strip on home view
- Filter by tag; search by title (FTS5)

> **UI frame:** the three-pane workspace, the graph-owns-center layout, and the nav surfaces are specified by the `node-workspace-ui` change; the canvas itself is specified by `react-flow-node-canvas`. This phase fills them with real data instead of fixtures.

**Demo:** Create a node → attach a PDF → see it in the graph → click to enter → file is processed async → BTP fires.

---

## Phase 3a — Accounts
*Goal: One install, several learners, each with their own graph.*

- `Profile` identified by `(provider, subject)`; workspaces are owned by a profile and every request is scoped server-side
- **BREAKING**: workspace routes stop accepting a client-supplied `workspaceId`
- **Local sign-in**, registered unconditionally, so a fresh install is enterable with no environment variable, no network, and no external service. Delivered by `first-launch-entry`; it is what makes the phase shippable without waiting on any provider console.
- Development sign-in (gated, no external service) remains beside it, and is what the Playwright suite signs in with — its derived subject is repeatable, which local sign-in's random one deliberately is not
- Sign-out preserves data; deleting an account is a separate confirmed action
- Google (PKCE + loopback) and GitHub (device flow) adapters follow as `oauth-identity-providers`. **No longer a prerequisite for using the app** — they add a portable identity that travels between machines, rather than the only way in.

**Demo:** create a profile by name → build a graph → sign out → create a second profile → an empty graph → select the first from the picker → the first graph returns.

---

## Phase 3b — Projects + Archive
*Goal: Group a graph without severing it.*

- `Project` groups nodes within one account; a node belongs to exactly one, a **link may cross** projects
- Project-level instructions and attached sources, layered over account-wide ones (nearest scope wins)
- Archive as a state on projects and nodes — off the canvas and the recents rail, still searchable and restorable
- Canvas renders project membership as grouping, not as a separate graph per project

**Demo:** move a node into a project → its instructions apply → archive a project → it leaves the canvas → search still finds it → restore it.

---

## Phase 4a — Agent Backends over ACP
*Goal: A node conversation runs on a subscription the learner already has — no API key.*

Delivered by `acp-agent-backend`. Inserted ahead of Phase 4 because it makes the conversation live at zero marginal cost, and because it builds the streaming route Phase 7 assumed would already exist.

- `Agent` contract (session-stateful) defined beside the `Provider` contract (stateless); only `Agent` implemented here
- Agents registered by command — Codex (ChatGPT) and Claude Code presets (Google: deferred, `agy-antigravity-agent`) — and authenticated through their own clients; no credential ever handled here
- Account-scoped default agent; a node records its agent on its first turn
- Streaming turn over SSE, with cancellation and a recorded outcome per turn
- Continuity across restarts via `session/load`, with transcript replay (and a visible seam) when it is unavailable
- Compaction and inference-time skill merging declared unavailable on agent backends

**Demo:** Settings → register Codex from the preset → Test → create a node → chat on the ChatGPT subscription → restart the app → the conversation continues.

---

## Phase 4b — Agent Permissions + Branching
*Goal: An agent can act, read what the learner attached, and branch.*

Delivered by `acp-agent-permissions-and-branching`.

- Permission prompt inline and in a workspace-level indicator; reads inside the node auto-approved
- Remembered decisions, scoped and revocable, never crossing agents or accounts
- Node attachments placed in the node's working directory, removed with the node
- Branching on agent backends: fresh session + parent transcript up to the anchor

**Demo:** Ask the agent to write and run a solution → approve → it runs → branch from a passage → the child knows the parent's conversation up to that point.

---

## Phase 4 — AI Provider Layer + BYOK
*Goal: Pluggable AI with the user's own keys.*

- Define `Provider` protocol; implement `AnthropicAdapter`, `OpenAIAdapter`, `OpenRouterAdapter`, `OllamaAdapter`
- Settings UI: paste API keys → stored encrypted (AES-GCM, key from macOS Keychain via `security` CLI)
- Pick default provider + model per node (inherited from parent by default)
- Connection test: POST `/providers/test` → streams a "hello" token response
- Streaming SSE route: reuses Phase 4a's `POST /chat/turn`; a `Provider` backend yields the same `TurnEvent`s an `Agent` does
- No chat UI yet — just a "test chat" button in settings that shows streaming tokens

**Demo:** Settings → paste Anthropic key → click test → tokens stream in real time.

---

## Phase 5 — Skills System
*Goal: Markdown-defined skills load into the agent at inference time.*

- Skills directory structure: `~/.learn-nodes/skills/<name>/skill.yaml + body.md`
- Built-in skills: `web-research`, `quiz-master`, `code-explainer`, `study-coach`
- Skill loading: read `skill.yaml` + `body.md` → merge into system prompt per request
- Node creation UI: toggle which skills are active for this session
- Skills stored as JSON list on the Node row
- Validation: skill directory must have valid `skill.yaml` — invalid skills silently skipped

**Demo:** Node A (no skills) → Node B (quiz-master active) → same provider, same parent context → agent behaves differently.

---

## Phase 5a — Command Palette
*Goal: Skills are reachable, not merely configured.*

- ⌘K palette over nodes, projects, and skills
- Skills invocable as commands from the palette and from the conversation composer
- Command surface is generated from the loaded skill set, so a new skill is reachable without UI work

**Demo:** drop a skill folder in `~/.learn-nodes/skills/` → ⌘K → it is listed → run it in the open node.

---

## Phase 6 — MCP Foundation
*Goal: External tools available to the agent, user-configured.*

> **Not to be confused with `agent-shared-context-mcp`**, which goes the other way: there the application *is* an MCP server that agents call for the learner's sessions, practice, and memory. This phase is the application *consuming* external MCP servers.

- MCP client: connect to a configured MCP server URL via SSE
- Settings UI: add/remove MCP server (URL + auth token)
- MCP tools merged into the same `Tool` list as built-ins before sending to provider
- Sandbox subprocess for local MCP servers (filesystem, code-exec) — no direct process access from the MCP server binary
- Graceful degradation: if an MCP server is unreachable, its tools are absent from the tool list (not a hard error)

**Demo:** Configure a filesystem MCP server → chat "read my notes on FP" → agent uses the MCP tool → returns content from local file.

---

## Phase 7 — Node Chat
*Goal: Every node is a living conversation.*

- Per-node chat panel on the node detail view
- Chat messages stored in `ChatMessage` table (role, content, timestamp)
- Streaming responses via SSE using the configured provider — the route, the turn recording, and cancellation are inherited from Phase 4a rather than defined here
- Agent context = node body + extracted file content + active skills + active MCP tools
- Skills and MCP tools invocable from chat via the unified tool list
- BTP re-injects completed file content into active context when fired

> **UI frame:** the node conversation surface, in-node threads, and the selection affordance are specified by the `node-workspace-ui` change. This phase makes the conversation live (streaming, real provider) rather than fixture-backed.

**Demo:** Enter node → chat with agent → agent uses skill → agent calls MCP tool → response streams in real time.

---

## Phase 8 — Branching + Inheritance + Fork Point
*Goal: New sessions branch from any point in any existing session.*

- "New session from this node" button → opens branch configuration modal:
  - Override title (default: parent title + " — branch")
  - Override mode (default: inherit from parent)
  - Override active skills (default: inherit from parent)
  - Override MCP servers (default: inherit from parent)
  - Fork point: which turn in parent chat to branch from (default: last turn)
  - Checkbox: "include parent's compacted summary as context"
- On create: new `Node` row with `parent_id` = source node ID, `fork_point` = selected turn
- New node's chat starts empty (fresh thread); parent's full history is reference context
- Graph view updates to show the new child link immediately

> **UI frame:** branching from a text selection — and the node-vs-thread choice — is specified by the `node-workspace-ui` change. Note that `fork_point` as a turn index is superseded there by a `SelectionAnchor` (`message_id`, `start`, `end`, `excerpt`), because a branch anchors to a passage, not a whole turn.

**Demo:** Node A (5 turns) → branch at turn 3 → Node B created → enter Node B → chat continues from turn 3 context → graph shows Node B as child of A.

---

## Phase 9 — Correction + Propagation
*Goal: Corrections are stored, applied to the node, and optionally propagated to children.*

- Inline "correct this" action on any agent message → correction modal:
  - Original text shown
  - User enters corrected text
  - `Correction` row created (original, corrected, message_id)
  - Node body updated to reflect corrected understanding
  - Correction also persisted in the chat log
- Propagation UI (appears on node with children):
  - "This correction may affect N child nodes"
  - Per-child: checkbox + "view diff" → shows side-by-side original vs corrected, with child's reliance noted
  - User selects which children to propagate to
  - Propagated corrections create new `Correction` rows on children (not auto-applied — children see the diff and choose)
- Shared children (DAG): if a node appears under multiple parents, each parent's correction shows in that child's propagation list

**Demo:** Correct agent in Node A → propagate to Node B (child) → open Node B → correction row visible + diff shown → apply or skip.

---

## Phase 10 — Hierarchical Compaction
*Goal: Context stays under ~50% of model window; every summary step is stored and drillable.*

- Token counter on each chat request (estimate via provider's count endpoint or local tiktoken)
- Auto-compact at ~50% context threshold:
  - Recent turns (verbatim) kept
  - Older turns → `CompactionStep` at "turn" level (one summary per turn or small group)
  - Multiple turn-level summaries → topic-level summary (`CompactionStep` at "topic")
  - One topic summary per active topic thread
- `CompactionStep` stored with: level, summary_body, turns_covered (range), created_at
- Drill-down UI: click a summary → expand to see underlying turns
- Manual "compact now" button
- On node creation from chat: compacted summary becomes the new node's body

**Demo:** Long chat (~100 turns) → auto-compaction fires → older turns summarized → drill-down on summary shows original turns → graph of summary levels visible.

---

## Phase 11 — Persistent Memory
*Goal: Cross-node facts are extracted and available everywhere.*

> **Core delivered by `agent-shared-context-mcp`:** agents propose memory through the local context server (`propose_memory`, with a stable `topic` so a fact is revised rather than duplicated); the learner accepts, edits, or rejects each proposal in the memory panel; accepted memory is readable by every agent in every session (`recall_memory`) rather than injected into prompts. Remaining here: proposing memory automatically after each chat.

- `Memory` table: `id`, `fact` (short atomic statement), `source_node_id`, `created_at`
- After each chat: agent proposes 0–3 memory candidates ("things the learner now knows that weren't known before")
- Memory panel: user sees proposed facts → accepts / edits / rejects each
- Accepted memories injected as system context into every new conversation
- Memory panel UI: list all memories, edit, delete, export as Markdown
- Memories are per-learner (not per-node)

**Demo:** Chat about Haskell → agent proposes "Haskell uses lazy evaluation by default" → accept → new chat about FP → memory surfaced in context → agent references it.

---

## Phase 12 — Practice (Self-Authoring)

> **Partly delivered:** `practice-rail-foundation` built the rail (Q&A, Quiz, and a WASM Python sandbox); `agent-shared-context-mcp` lets agents author questions and code exercises into it (`add_question`, `add_code_exercise`, or `/qa`, `/quiz`, `/code` in the composer), delivered to the rail as they are created.
*Goal: Agent generates practice material from node content — code, Q&A, quiz — without a separate pipeline.*

- Mode-driven practice generation:
  - **Practice mode**: agent self-authors exercises + expected answers + grading rubric
  - **Quiz mode**: agent self-authors multiple choice + short answer questions + rubrics
- Practice UI: appears as a tab on the node (Code / Q&A / Quiz)
- **Code sandbox** — Pyodide (in-browser Python): run learner's code, compare against expected output, show diff
- **Q&A** — free-text answer submitted → LLM grades against rubric → score + feedback shown
- **Quiz** — multiple choice + short answer → self-graded or manual review
- Practice attempts stored as `PracticeAttempt` rows linked to the source node
- Practice results surface on the source node as a summary strip

**Demo:** Enter Practice tab on a Haskell node → agent generated 3 code problems + 2 Q&A questions → answer a problem → Pyodide runs it → grade shown → result linked back to Haskell node.

---

## Phase 13 — Study Session Window + Mode Orchestrator
*Goal: The main entry point: topic + mode + file → platform assembles everything.*

- Full-window study launcher:
  - Topic input (text)
  - Mode buttons (Deepen / Review / Practice / Quiz / Explore) — defaults configurable
  - File upload slot (text/image)
  - "Configure agent" link → override skills + MCP for this session
- Orchestrator state machine:
  ```
  INIT → PROCESSING_FILE → FINDING_NODE → RUNNING_AGENT → GENERATING_PRACTICE → COMMITTING → DONE
  ```
- BTP between file processing and agent run (async; user can start chatting while file extracts)
- On commit: new node (or reuse existing) + chat thread + practice attempts — all linked
- Error recovery: if any step fails, user sees what succeeded and can retry from that step
- macOS notification when a background file finishes processing (BTP)

**Demo:** Study launcher → "functional programming" → Practice mode → upload Haskell notes PDF → BTP fires when ready → agent runs → practice generated → node created with chat + practice → graph updates.

---

## Phase 14 — Polish + Distribution
*Goal: Shippable. macOS users can download and run.*

- Keyboard shortcuts (⌘N new node, ⌘K command palette, ⌘F search, ⌘B branch from current)
- Dark mode (system-driven via Tailwind `dark:`)
- Backlinks panel: "nodes that reference this one" (incoming links shown on node detail)
- FTS5 search across all node titles and bodies
- Export to plain Markdown folder (one `.md` per node, structured for import)
- Import from a Markdown folder (one `.md` → one node)
- `.dmg` build with code signing + notarization instructions documented
- README with clear install steps

**Demo:** `npm run tauri build` → `.dmg` produced → double-click → app opens → all Phase 13 features work.

---

## Phase 15 — Open Ecosystem Enablement
*Goal: Others can extend, port, and build on top.*

- CLI companion (`learn-nodes`) — same backend, headless: `learn-nodes serve`, `learn-nodes node create`, `learn-nodes chat`
- Skill authoring guide: how to write a skill.yaml + body.md
- Provider adapter guide: how to implement the `Provider` protocol for a new backend
- MCP server guide: how to configure community MCP servers
- `examples/` folder: 3 sample skills, 2 MCP configs, 1 community provider adapter
- `learn-nodes.toml` registry file: named, versioned references to community skills, providers, MCP configs
- Documentation site (MkDocs or similar): user guide + developer guide

---

## Deferred (post-v1)

| Item | Reason deferred |
|---|---|
| ~~**Subscription providers**~~ | **No longer deferred.** Promoted into Phase 4a as an additional source of the same `Credential`. Verify each provider's consumer terms before shipping its adapter — a third-party client using a consumer subscription is not automatically permitted. |
| **Written response practice format** | Needs LLM rubric grading that's harder to evaluate than Q&A |
| **Multiple-choice practice format** | Needed for Quiz mode; can add once Q&A is proven |
| **Video file analysis** (ffmpeg + Whisper) | Heavy deps; text + image covers most v1 use cases |
| **sqlite-vec vector search** | FTS5 handles keyword search; vector search for semantic recall is additive |
| **Collaboration / multi-user** | Data model supports it; the UX for multi-user is a full redesign |
| **Linux, Windows ports** | Tauri makes this feasible; community ports are the right path |
| **Mobile** | Out of scope for the desktop-first phase |

---

## Phase Dependencies

```
Phase 0 ─► 1 ─► 2 ─► 3 ─► 3a ─► 3b ─► 4 ─► 5 ─► 5a
(skeleton) (model) (CRUD  (accounts) (projects) (provider) (skills) (commands)
                   +graph)                       layer)
                                          │
                                          ▼
                                 Phase 6 (MCP)
                                          │
                                          ▼
Phase 10 ◄── Phase 9 ◄── Phase 8 ◄── Phase 7 ◄─┘
(compaction)  (correction) (branching) (chat)
    │
    ▼
Phase 11 (memory)
    │
    ▼
Phase 12 (practice)
    │
    ▼
Phase 13 (study orchestrator)
    │
    ▼
Phase 14 (polish + distribution)
    │
    ▼
Phase 15 (open ecosystem)
```
