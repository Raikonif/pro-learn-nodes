# Tech Stack

## App Shell

- **Tauri 2** (Rust + system WebView) — small bundle (~10MB), native macOS feel, FastAPI runs as a bundled sidecar binary.

## Frontend

- **React 19** + **TypeScript** (strict)
- **Vite** — bundler / dev server
- **Tailwind CSS** — styling
- **Zustand** — local state
- **React Router** — routing

## Editor

- **TipTap** (ProseMirror-based) — rich text authoring
- **Shiki** — syntax highlighting in code blocks

## Backend

- **Python 3.12+**
- **FastAPI** — async HTTP API (one process, also runs as Tauri sidecar)
- **uv** — Python package manager (fast, lockfile-driven)
- **Pydantic v2** — validation, settings, serialization
- **SQLModel** — ORM (Pydantic + SQLAlchemy 2.0; one model = DB row + API schema)
- **Alembic** — migrations

## Storage

- **SQLite** (single file, local-first)
- Nodes store content as **Markdown with YAML frontmatter**; structure (links, tags, timestamps) lives in SQL columns
- **FTS5 virtual table** — built-in full-text search
- **sqlite-vec** (planned) — local vector search for semantic recall

## Graph & Visualization

- **react-force-graph** — interactive 2D/3D graph navigation
- **Mermaid** — static diagram rendering inside node bodies

## AI Provider Layer (Pluggable, BYOK)

A single `Provider` interface that every concrete backend implements:

```python
class Provider(Protocol):
    async def stream_chat(messages, tools, model, **opts) -> AsyncIterator[Event]: ...
    async def embed(texts: list[str]) -> list[list[float]]: ...
    async def vision(prompt: str, images: list[bytes]) -> str: ...
```

- **Built-in adapters:** `AnthropicAdapter` (Claude), `OpenAIAdapter` (GPT), `OpenRouterAdapter`, `OllamaAdapter` (local)
- **BYOK** — users paste their own API keys; keys stored encrypted (AES-GCM, key from macOS Keychain)
- **Subscription adapters** (later): Codex / ChatGPT, Claude Pro/Max — same interface, different auth

## Skills & MCP

Two complementary systems, unified at the LLM tool boundary:

- **Skills** — markdown files (frontmatter + body) that define behavior/persona/instructions the agent loads per context. Same shape as Claude Code skills. Versionable in git.
- **MCP servers** — external tool providers via Model Context Protocol. Connect to filesystem, search, code-exec, or community MCP servers.
- The agent sees **one tool list** — the union of skill-defined tools + MCP tools + built-ins.

## Compaction (Hierarchical)

Long conversations compress into a chain of summaries:

```
turns 1–N  →  topic summary  →  node summary (persisted)
                ↓
       can be drilled back to original turns
```

- **Triggered** by token thresholds, explicit user action, or node creation
- **Multi-level** — model picks the granularity that fits the context window
- **Inspectable** — every compaction step is stored, not destroyed

## Persistent Memory

- A `memory` table holds cross-node facts the agent has extracted (or you've added)
- Surfaced as context for every new conversation
- Editable, deletable, exportable

## Practice Section (v1)

- **Code sandbox** — Pyodide (in-browser Python) for safe execution; optional remote exec later
- **Q&A** — generated from node content; structured answer + grading
- *Written response* and *multiple choice* — later phases

## File Processing (v1)

- **Text / PDFs** — extracted via PyMuPDF
- **Images** — analyzed via provider's vision capability
- *Video* — deferred (needs ffmpeg + frame extraction + transcription)

## Study Session Window

- Topic prompt + study-mode buttons (default modes: *deepen*, *review*, *practice*, *quiz*, *explore*)
- File upload slot for context
- Orchestrates: node creation → agent run → practice → new linked nodes

## Tooling

- **Frontend:** ESLint, Prettier, TypeScript strict
- **Backend:** Ruff (lint/format), mypy (types), pytest
- **Build:** Tauri bundler → `.dmg` + `.app`
- **CI:** GitHub Actions — lint + test on every PR

## Open Ecosystem

- Skills, MCP server configs, and provider adapters live in user-editable folders
- First-class CLI (`learn-nodes`) so non-macOS users can drive the same backend
- Plugin discovery via a `learn-nodes.toml` registry file

---

## Why these choices

| Choice | Why |
|---|---|
| **Tauri over Electron** | ~10× smaller bundle, native feel, fast cold start |
| **FastAPI over tRPC** | Python's ML/AI ecosystem (sentence-transformers, PyMuPDF, Pyodide bridge) stays first-class |
| **SQLModel** | One model class = DB row + API schema; no manual sync |
| **SQLite** | One file, agent-friendly, backup = `cp`, FTS5 included |
| **BYOK** | No billing complexity, no quota surprises, no OAuth dance |
| **Pluggable providers** | Lock-in is the enemy of open source |
| **Skills + MCP** | Markdown skills are cheap to write and version; MCP is the emerging standard for tools |
| **Hierarchical compaction** | "Context inheritance" between nodes is a compaction problem; this solves it cleanly |