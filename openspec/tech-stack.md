# Tech Stack

## App Shell

- **Tauri 2** (Rust + system WebView) — small bundle (~10MB), native macOS feel, FastAPI runs as a bundled sidecar binary.
- Tauri ↔ FastAPI communication: **HTTP on localhost** during dev; Unix socket in production builds for reliability.
- Dev ports are allocated, not fixed: **5177** (frontend) and **8009** (backend) by default, falling back to the next free port. In dev the frontend issues relative `/api/*` requests to the Vite dev server, which strips the prefix and forwards to the backend — so browser traffic is same-origin and CORS is not on the request path. A process allocates the port it binds and discovers the ports it only connects to.

## Frontend

- **React 19** + **TypeScript** (strict)
- **Vite** — bundler / dev server
- **Tailwind CSS** — styling
- **Zustand** — local state
- **React Router** — routing
- **React Flow (`@xyflow/react`)** — the session graph canvas: custom chat-like node cards, directed branch edges, viewport controls, minimap. Chosen over a force-directed renderer because a learning graph is read as structure, not as a physics simulation — cards carry titles and mode, and positions must stay where the learner put them.
- **TipTap** — rich text authoring in node bodies
- **Shiki** — syntax highlighting in code blocks
- **Vitest** — unit and integration testing
- **React Testing Library** — component UI behavior
- **Playwright** — end-to-end testing
- **Zod** — schema TypeScript validation (request/response, form data)

### Frontend Architecture (Scream)

Code is organized by **what the application does**, not what technology it uses. Feature directories scream their purpose:

```
frontend/src/
├── features/              ← primary organizing unit
│   ├── graph-navigation/  ← "this app navigates knowledge graphs"
│   │   ├── components/    ← SpatialCanvas, OutlineTree, TimelineView
│   │   ├── hooks/        ← useGraphData, useNodeSelection
│   │   ├── types/        ← GraphViewMode, NodePosition
│   │   └── index.ts      ← public API surface
│   ├── node-chat/         ← "sessions are living conversations"
│   ├── study-launcher/    ← "study on demand"
│   ├── settings/          ← "configure providers, skills, MCP"
│   └── practice/         ← "self-authored exercises"
├── shared/                ← cross-cutting, not feature-specific
│   ├── components/        ← Button, Input, Modal (generic)
│   ├── hooks/            ← useLocalStorage, useDebounce
│   └── lib/              ← markdown parser, FTS helpers
└── app/                  ← routing and entry point only
    ├── routes/
    └── App.tsx
```

Rule: features export through `index.ts`; other features import from the public surface, never internal paths.

- **Python 3.13+**
- **FastAPI** — async HTTP API (one process, also runs as Tauri sidecar)
- **uv** — Python package manager (fast, lockfile-driven)
- **Pydantic v2** — validation, settings, serialization
- **SQLModel** — ORM (Pydantic + SQLAlchemy 2.0; one model = DB row + API schema)
- **Alembic** — migrations
- **SSE (Server-Sent Events)** — streaming responses from FastAPI to React (not WebSocket — simpler, sufficient)
- **Pytest** — unit and integration testing

### Backend Architecture (Layered)

Strict layer separation enforces clear contracts between request handling, business logic, and data access:

```
backend/
├── api/                    ← PRESENTATION LAYER
│   ├── routes/            ← FastAPI routers (@router.get, @router.post)
│   ├── dependencies/      ← FastAPI deps (get_db, get_current_user)
│   └── schemas/           ← Pydantic request/response models
├── service/               ← BUSINESS LOGIC LAYER
│   ├── node_service.py   ← Node CRUD + branching logic
│   ├── chat_service.py   ← Streaming, context assembly
│   └── practice_service.py
├── repository/            ← DATA ACCESS LAYER
│   ├── node_repo.py      ← SQLModel queries for Node
│   └── chat_repo.py
├── models/                ← DOMAIN / DB MODELS
│   └── *.py              ← SQLModel classes (Node, ChatMessage, etc.)
└── core/                  ← SHARED INFRA
    ├── config.py          ← Settings (Pydantic BaseSettings)
    ├── database.py        ← SQLite connection
    └── exceptions.py
```

Rule: `api` → `service` → `repository` → `models`. Direct calls from `api` to `repository` are a layer violation.

## Storage

- **SQLite** (single file, local-first)
- Nodes store body as **Markdown with YAML frontmatter**
- Node structure (parent_id, fork_point, mode, timestamps) lives in SQL columns
- **FTS5 virtual table** — built-in full-text search across titles and bodies
- **sqlite-vec** (planned) — local vector search for semantic recall

## Data Model (Core Entities)

```
Node
├── id, title, mode, body (Markdown)
├── parent_id (nullable)          ← null = root session
├── fork_point (int)              ← turn number in parent where branching happened
├── active_skills (JSON list)    ← skills active for this session
├── mcp_servers (JSON list)      ← MCP servers active for this session
├── created_at, updated_at
│
├── children[]                   ← sessions branched from this one
├── files[]                      ← FileAttachment (text/PDF/image)
├── chat[]                       ← ChatMessage (ordered)
├── corrections[]                ← Correction (stored, with propagation state)
├── practices[]                  ← PracticeAttempt (code/Q&A/quiz)
└── compaction_chain[]            ← CompactionStep (stored, drillable)

Correction
├── id, node_id
├── original_text
├── corrected_text
├── applied_to_message_id
├── propagated_to_child_ids[]    ← user-selected
├── propagated: bool
└── created_at

CompactionStep
├── id, node_id
├── level (turn | topic | node)
├── summary_body
├── turns_covered (range)
└── created_at
```

## Accounts

A desktop install holds several accounts, each with its own graph. Identity is the pair `(provider, subject)`; email and display name are refreshed on every sign-in and never identify anyone.

- Sign-in follows **RFC 8252 (OAuth 2.0 for Native Apps)** — system browser, never an embedded webview, and no client secret in the bundle. Google uses PKCE with a loopback redirect (its any-port rule fits the allocated-port model); GitHub uses **Device Flow**, which has no redirect at all and so is immune to a moving port.
- A **development sign-in** enrolls an account with no external service at all. It is gated by a process-environment-only setting, absent (404) when closed, and is what lets the Playwright suite sign in — browser automation cannot pass a hosted consent screen.
- OAuth is **enrollment, not a session gate**: it runs once per account. Afterwards the active account is a pointer in the system Keychain, so launching works offline.
- The partition is **not a security boundary**. Local data is a readable file and the Keychain is scoped to the OS user. It separates work, not people with disk access.

## Projects

A project groups nodes within one account's graph, mirroring the container model ChatGPT Projects established, with one deliberate difference.

- A node belongs to **exactly one** project; a **link may cross** projects. That keeps the mission's shared-child DAG expressible — a node lives in one project and stays reachable from a parent in another — which a strict containment model would forbid.
- Projects carry **instructions** and **attached sources** that apply to every node inside them, layered over the account-wide equivalents. The precedence rule follows Codex's `AGENTS.md`: the nearest scope wins.
- **Archive** is a state on a project and on a node, not a deletion. Archived material leaves the canvas and the recents rail but stays searchable and restorable.

## AI Provider Layer (Pluggable, BYOK)

A single `Provider` protocol that every adapter implements:

```python
class Provider(Protocol):
    async def stream_chat(
        messages: list[Message],
        tools: list[Tool],
        model: str,
        skills: list[str],
    ) -> AsyncIterator[ChunkEvent]: ...

    async def embed(texts: list[str]) -> list[list[float]]: ...
    async def vision(prompt: str, images: list[bytes]) -> str: ...
```

- **Built-in adapters:** `AnthropicAdapter`, `OpenAIAdapter`, `OpenRouterAdapter`, `OllamaAdapter`
- **BYOK** — users paste API keys; stored encrypted (AES-GCM, key in macOS Keychain)
- **Subscription sign-in** — where a provider offers an OAuth flow for a consumer subscription, it is an additional *source* of the same `Credential`, not a separate path. Adapters see a bearer token and a base URL and never learn which source produced it.
- **Skills at inference time** — the provider receives the active skill list per request; skills are not build-time plugins

## Skills System

Skills are **markdown files with YAML frontmatter** loaded at inference time:

```
~/.learn-nodes/skills/
├── web-research/
│   ├── skill.yaml       ← name, description, version
│   └── body.md         ← agent instructions (loaded into system prompt)
├── quiz-master/
│   ├── skill.yaml
│   └── body.md
├── code-explainer/
│   ├── skill.yaml
│   └── body.md
└── study-coach/
    ├── skill.yaml
    └── body.md
```

- Skill schema (skill.yaml):

```yaml
name: quiz-master
description: "Creates quiz questions and grading rubrics from source material"
version: "1.0"
tools: []          # optional: named tools this skill defines
```

- The agent receives **one merged system prompt** = base prompt + active skills' body content
- Skills are **inference-time toggles** — activating/deactivating doesn't restart anything
- Skills are versioned in git (plain markdown files)

## MCP (Model Context Protocol)

- **User-configured** via a settings panel (list of MCP server URLs + auth tokens)
- MCP servers run **locally or remotely** — filesystem, web-search, code-exec, GitHub, etc.
- MCP tools are merged into the **same tool list** the agent sees as built-in tools
- Security: local MCP servers (filesystem, code-exec) run in a sandboxed subprocess
- Community MCP servers: users add via URL; no app store required

## Mode System

Every node has a `mode` that shapes the agent's behavior:

| Mode | System Prompt Effect | Tools Available | Output Format |
|---|---|---|---|
| **Deepen** | Expand concepts, add depth | All skills + MCP | Explanatory prose |
| **Review** | Condense, reinforce | memory recall | Bullets, Q&A pairs |
| **Practice** | Quiz-master persona | code sandbox + grading rubric | Generated exercises + expected answers |
| **Quiz** | Socratic, ask before telling | question-generation skill | Multiple choice + short answer + rubrics |
| **Explore** | Follow curiosity threads | web-search + MCP | Questions the learner might not have asked |

- Mode is set at node creation (inherited from parent or overridden)
- Mode affects system prompt, available tools, and output shaping
- The agent **self-authors practice material** — questions, code sandboxes, rubrics — from the node's content

## BTP (Back-To-Previous) — Async File Processing

```
User uploads file
         │
         ▼
  ┌──────────────────────────┐
  │  Processing starts async │
  │  (PyMuPDF for text/PDF,  │
  │   vision API for images) │
  └────────────┬─────────────┘
               │ extraction completes
               ▼
  ┌─────────────────────────────────────┐
  │  BTP event emitted to active session │
  │                                       │
  │  Agent: "File ready. I've incorporated│
  │   it into context. Continue?"        │
  │                                       │
  │  Chat history preserved.              │
  │  File content added to context.      │
  └───────────────────────────────────────┘
```

- BTP is a server-sent event emitted to the node's active SSE connection
- If the node is closed, the event queues; next time the node opens, agent is notified
- macOS notification sent if app is backgrounded

## Compaction (Hierarchical)

```
Context window: ~50% trigger point

[ turn 1 ] [ turn 2 ] [ turn 3 ] ... [ turn N ]
    │
    │ turns compress into topic summaries
    ▼
[ topic summary 1 ] [ topic summary 2 ] [ recent turns ]
    │
    │ topic summaries compress into node summary
    ▼
[ node summary ] [ recent turns ]
    │
    │ stored: every compaction step is inspectable
    │ drill-down: expand any summary → see underlying turns
```

- **Trigger:** ~50% of model's context window, or manual "compact now"
- **Levels:** turn → topic → node (model picks granularity)
- **Stored:** every step is a `CompactionStep` row — never destroyed, always drillable
- **On node creation from chat:** the compacted summary becomes the new node's body

## Practice System (v1)

- **Code sandbox** — Pyodide (in-browser Python, no server exec needed)
- **Q&A** — LLM generates questions from node content; LLM grades free-text answers via rubric
- **Quiz** — LLM generates multiple choice + short answer; self-graded or manually graded
- Practice attempts are **nodes' children** — they link back to the source node
- Agent self-authors: the same agent running the chat generates the practice material (no separate pipeline)

## Graph Navigation

Three navigation modes available as tabs/toggles:

```
┌─────────────────────────────────────────────────────────────┐
│  SPATIAL CANVAS (React Flow / @xyflow/react)                │
│  ─────────────────────────────────────────────────────────  │
│  Nodes as circles, links as lines, pan/zoom, click to enter │
│  Color = mode, size = recency, line thickness = recency     │
│  Best for: seeing the overall shape of your knowledge       │
├─────────────────────────────────────────────────────────────┤
│  OUTLINE (primary)                                           │
│  ─────────────────────────────────────────────────────────  │
│  Collapsible tree, shows branching and shared children      │
│  [FP]                                                       │
│   ├─ [Haskell]                                              │
│   │   ├─ [Functors]                                         │
│   │   └─ [Monads]                                           │
│   └─ [Category Theory]                                      │
│       └─ [Functors]  ← shared child shown twice             │
│  Best for: finding a specific session, seeing depth          │
├─────────────────────────────────────────────────────────────┤
│  TIMELINE                                                    │
│  ─────────────────────────────────────────────────────────  │
│  Horizontal stream with branching shown as forks            │
│  [──── FP ────┬── Haskell ─── Functors ─── Monads ]        │
│                └── Category Theory ──┬── Functors ]          │
│  Best for: understanding temporal flow of study             │
└─────────────────────────────────────────────────────────────┘
```

## Tooling

- **Frontend:** ESLint, Prettier, TypeScript strict
- **Backend:** Ruff (lint/format), mypy (types), pytest
- **Build:** Tauri bundler → `.dmg` + `.app`
- **CI:** GitHub Actions — lint + test on every PR

## Open Ecosystem

- Skills: plain markdown files in `~/.learn-nodes/skills/` — git-versionable, shareable as a repo
- MCP servers: configured via `~/.learn-nodes/mcp_servers.toml`
- Provider adapters: plain Python files in `~/.learn-nodes/providers/`
- CLI companion (`learn-nodes`) drives the same backend headlessly
- `learn-nodes.toml` plugin registry for community contributions

## Why These Choices

| Choice | Why |
|---|---|
| **Tauri over Electron** | ~10× smaller bundle, native macOS feel, fast cold start |
| **React Flow over a force-directed graph** | Positions are meaning, not physics: a learner arranges their own graph and it must stay arranged. Node cards also carry title and mode, which anonymous circles cannot. |
| **Accounts on top of BYOK** | An account partitions one machine's graphs and scopes provider credentials to the learner using them; it does not introduce billing or a server. |
| **FastAPI over tRPC** | Python ML ecosystem stays first-class (PyMuPDF, Pyodide bridge, sentence-transformers later) |
| **SQLModel** | One model = DB row + API schema; natural for the session tree data model |
| **SQLite** | One file, agent-inspectable, backup = `cp`, FTS5 included, supports DAG via self-join |
| **BYOK** | No billing complexity, no OAuth dance, no quota surprises |
| **SSE over WebSocket** | Streaming is unidirectional (server → client); WebSocket overhead isn't needed |
| **Skills as markdown files** | Versionable in git, no plugin system needed, community can share as repos |
| **MCP for tools** | Emerging standard; community servers already exist; no need to build tool integrations from scratch |
| **BTP async file processing** | Keeps the conversation fluid; user never waits for file extraction |
| **Mode-driven agent** | Lets one agent serve fundamentally different learning flows without changing providers |
| **Self-authoring practice** | The same context that informed the chat generates the practice; no separate pipeline |
| **Hierarchical compaction** | 50% trigger keeps context lean; stored steps mean nothing is ever truly lost |
