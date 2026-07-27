# Roadmap

Small, independently shippable phases. Each phase ends with something you can run and demo.

---

## Phase 1 — Project Skeleton
*Goal: A Tauri window opens and talks to a bundled FastAPI.*

- Scaffold Tauri 2 app with React 19 + Vite + TS + Tailwind
- Scaffold FastAPI project (uv-managed) with `/health` endpoint
- Wire FastAPI as Tauri sidecar binary; dev mode spawns it on launch
- App window shows a "Learn Nodes — hello world" placeholder
- `npm run tauri dev` and `npm run tauri build` both work end-to-end

---

## Phase 2 — Data Models & Migrations
*Goal: The shape of knowledge is defined.*

- Define SQLModel schemas: `Node`, `Link`, `FileAttachment`, `Tag`, `ChatMessage`, `Memory`
- Alembic migrations; auto-generate from models
- Seed script: 5 example nodes, a few links, sample chat history
- Open the `.db` file in DBeaver / sqlite3 CLI to inspect

---

## Phase 3 — Node CRUD + File Upload
*Goal: Create, read, update, delete nodes with attachments.*

- FastAPI routes: create/get/list/update/delete nodes
- React UI: node list, detail view, create/edit form
- Markdown body + YAML frontmatter stored in DB
- File upload endpoint (multipart): text/PDF (PyMuPDF) and image (stored + indexed)
- Node detail page shows title, body, attached files, tags

---

## Phase 4 — Graph View & Navigation
*Goal: Navigate the knowledge graph visually.*

- Add `react-force-graph` view; nodes = circles, links = lines
- Click a node → navigate to its detail page
- Filter by tag; search by title
- Recent nodes strip on home view

---

## Phase 5 — AI Provider Layer + BYOK
*Goal: Pluggable AI with the user's own keys.*

- Define `Provider` protocol; implement `AnthropicAdapter`, `OpenAIAdapter`, `OpenRouterAdapter`
- Settings UI: paste API keys, pick default provider/model
- AES-GCM encryption at rest; key fetched from macOS Keychain
- Connection test endpoint ("ping the provider with `hello`")
- One route `/chat` that streams a token stream back to the client (no real UI yet)

---

## Phase 6 — Skills + MCP Foundation
*Goal: Agents can use skills and external tools.*

- Skills directory: markdown files with YAML frontmatter (name, description, body = instructions)
- Built-in skills: `web-research`, `summarize`, `extract-concepts`, `study-coach`
- MCP client: connect to configured MCP servers; expose their tools to the agent
- Unified tool registry — the agent sees one merged tool list

---

## Phase 7 — Node Chat
*Goal: A conversation lives inside every node.*

- Per-node chat panel; messages stored in `ChatMessage` table
- Streaming responses (SSE or WebSocket) using the configured provider
- Agent context = node body + attached files (text extracted) + relevant memories
- Skills and MCP tools are invocable from chat

---

## Phase 8 — Compaction + Node Inheritance
*Goal: Long chats compress; new nodes inherit context.*

- Hierarchical compactor: turn-level → topic-level → node-level summaries
- Auto-compact on token-threshold; manual "compact now" button
- "Create node from chat" — generates a new node from the conversation, with the compacted summary as its body and links back to source turns
- Drill-down UI: expand a summary to see the underlying turns

---

## Phase 9 — Persistent Memory
*Goal: Cross-node facts surface everywhere.*

- `memory` table: short atomic facts the agent has extracted (or user added)
- After each chat, the agent proposes memory candidates; user accepts/edits/rejects
- Memories injected into every new conversation as system context
- Memory panel: list, edit, delete, export

---

## Phase 10 — Practice (Code + Q&A)
*Goal: Two practice formats that use the same node context.*

- **Code sandbox** — Pyodide in-browser Python; auto-grader for expected-output problems
- **Q&A** — generate questions from node content; free-text answer; LLM-graded rubric
- Practice attempts stored per node; results link back to the source node

---

## Phase 11 — Study Session Window
*Goal: The main "I want to learn X" entry point.*

- Full-window study launcher: topic input + study-mode buttons (default: *Deepen*, *Review*, *Practice*, *Quiz*, *Explore*)
- File upload slot for context (text/image)
- Orchestrator: spawns node(s), runs agent with the chosen mode, optionally queues practice
- Result: a newly-created node + practice attempts, all linked

---

## Phase 12 — Polish & macOS Distribution
*Goal: Shippable .dmg.*

- Keyboard shortcuts (⌘N new node, ⌘K command palette, ⌘F search)
- Dark mode (system-driven)
- Backlinks panel ("nodes that reference this one")
- Full-text search across titles and bodies (FTS5)
- `.dmg` build with code signing instructions documented
- Export to plain Markdown folder (portability guarantee)

---

## Phase 13 — Open Ecosystem Enablement
*Goal: Others can build on top.*

- CLI companion (`learn-nodes` binary): drives the same backend headlessly
- Documentation site: user guide + skill-author guide + provider-adapter guide
- Sample community skills and MCP server configs in a `examples/` folder
- `learn-nodes.toml` registry file for plugin discovery

---

## Deferred (post-v1)

- **Subscription providers** — Codex/ChatGPT, Claude Pro/Max via OAuth
- **Written response** and **multiple-choice** practice formats
- **Video file analysis** (ffmpeg + Whisper transcription)
- **Vector search at scale** via `sqlite-vec` (v1 uses keyword + in-memory embeddings)
- **Collaboration** — multi-user is explicitly out of scope; the data model leaves room for it later
- **Mobile, web** — community ports welcome, not on the core path