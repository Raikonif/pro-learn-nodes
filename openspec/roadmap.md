# Roadmap

14 phases, each independently shippable. Each phase ends with something you can run and demo. Phases 0–7 build the foundation. Phases 8–13 are where the differentiated experience emerges.

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
- Graph view (react-force-graph): spatial canvas with nodes as circles, links as lines
- Three nav tabs: Outline (tree), Canvas (spatial), Timeline
- Recent nodes strip on home view
- Filter by tag; search by title (FTS5)

**Demo:** Create a node → attach a PDF → see it in the graph → click to enter → file is processed async → BTP fires.

---

## Phase 4 — AI Provider Layer + BYOK
*Goal: Pluggable AI with the user's own keys.*

- Define `Provider` protocol; implement `AnthropicAdapter`, `OpenAIAdapter`, `OpenRouterAdapter`, `OllamaAdapter`
- Settings UI: paste API keys → stored encrypted (AES-GCM, key from macOS Keychain via `security` CLI)
- Pick default provider + model per node (inherited from parent by default)
- Connection test: POST `/providers/test` → streams a "hello" token response
- Streaming SSE route: `POST /chat/stream` → `AsyncIterator[ChunkEvent]`
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

## Phase 6 — MCP Foundation
*Goal: External tools available to the agent, user-configured.*

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
- Streaming responses via SSE using the configured provider
- Agent context = node body + extracted file content + active skills + active MCP tools
- Skills and MCP tools invocable from chat via the unified tool list
- BTP re-injects completed file content into active context when fired

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

- `Memory` table: `id`, `fact` (short atomic statement), `source_node_id`, `created_at`
- After each chat: agent proposes 0–3 memory candidates ("things the learner now knows that weren't known before")
- Memory panel: user sees proposed facts → accepts / edits / rejects each
- Accepted memories injected as system context into every new conversation
- Memory panel UI: list all memories, edit, delete, export as Markdown
- Memories are per-learner (not per-node)

**Demo:** Chat about Haskell → agent proposes "Haskell uses lazy evaluation by default" → accept → new chat about FP → memory surfaced in context → agent references it.

---

## Phase 12 — Practice (Self-Authoring)
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
| **Subscription providers** (Codex, Claude Pro/Max OAuth) | OAuth flows per provider are significant work; BYOK covers most users |
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
Phase 0  ──► Phase 1  ──► Phase 2  ──► Phase 3  ──► Phase 4  ──► Phase 5
 (skeleton)    (model)    (CRUD+    (provider   (skills)
                              graph)      layer)
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
