# Mission

A personal learning platform where **conversational sessions form a navigable graph**, **AI agents amplify without replacing the learner**, and **the architecture is open, local-first, and built to last**.

## What It Is

A downloadable, open-source learning environment for macOS that feels like a blend of AI Studio's conversational depth and a spatial knowledge graph — but where **navigation through the graph IS the product**.

Think of it as: *sessions, not chats. A graph, not a list. Corrections that compound. Context that outlives any single conversation.*

### Core Experience

```
You open the app
     │
     ▼
┌─────────────────────────────────────────────┐
│  GRAPH VIEW — your session tree in space     │
│                                             │
│    ┌── Functional Programming ──┐          │
│    │                             │          │
│    │  ┌─ Haskell ──┐  ┌─ Cat Theory ─┐   │
│    │  │            │  │               │   │
│    │  └─ Functors  │◀─┤    Functors   │   │ ← shared child (DAG)
│    │               │  │               │   │
│    │  ┌─ Monads ───┘  └───────────────┘   │
│    │  │                                    │
│    └──┴────────────────────────────────────┘
│                                             │
│  You navigate → enter a node → chat →       │
│  branch → correct → propagate (or not) →   │
│  practice → compact → new session → ...    │
└─────────────────────────────────────────────┘
```

## What You Do In It

- **Navigate** a session graph — spatial canvas, outline, or timeline — and enter any node directly
- **Chat with an AI agent** grounded in your own nodes, files, and memories
- **Branch a new session** from any point in any conversation, inheriting what you choose
- **Correct the agent mid-conversation** — and propagate those corrections to child sessions when you choose
- **Practice** with self-authored exercises — code, Q&A, quizzes — generated from your own material
- **Study on demand** — pick a topic, a mode, upload a file, and the platform assembles nodes + agent + practice around it
- **Configure skills and MCP servers** to extend what the agent can do

## Core Principles

1. **Sessions Are Nodes** — Every conversation lives in a node. Every node is a session. They are the same thing.
2. **Graph Navigation IS the Product** — You traverse links between sessions, not search through chat history. The shape of the graph is a first-class UX concern.
3. **Inheritance with Foresight** — Child sessions inherit context from parents (linked, not copied). You choose what carries forward.
4. **Corrections Compound** — When you correct the agent, the node updates. You decide whether children are notified.
5. **Self-Authoring Practice** — The agent generates questions, quizzes, and code sandboxes from your material — not from generic templates.
6. **Skills Are Inference-Time Toggles** — Activate or deactivate skills per session. They don't require a restart.
7. **MCP Is User-Configured** — You decide which MCP servers are running globally and per-session.
8. **Async File Processing** — Upload a file and keep chatting. The agent catches up when it's ready (BTP).
9. **Hierarchical Compaction** — Context compresses at ~50% of the model's window. Every summary step is stored and drillable.
10. **Persistent Cross-Node Memory** — Facts the agent extracts are stored globally, surfaced in every new session.
11. **Yours Forever** — Local-first. Plain-text where possible. BYOK. No billing platform.
12. **Open Ecosystem** — macOS first. CLI companion. Community ports welcome. Skills and MCP configs are plain files.

## Anti-Goals

- **Not a chat list** — sessions are not isolated conversations you search; they are a graph you navigate
- **Not auto-propagation** — corrections never flow downstream without explicit user consent
- **Not a billing platform** — you bring your own API keys
- **Not a closed garden** — export is plain Markdown, the DB is SQLite, skills are markdown files
- **Not a replacement for tutors** — an amplifier of the learner's own exploration

## Data Model Core

```
┌──────────────────────────────────────────────────────────────┐
│  NODE (Session)                                               │
│  ─────────────────────────────────────────────────────────  │
│  id, title, mode, body (Markdown)                           │
│  parent_id (nullable) — links to the session this branched from│
│  fork_point (int) — which turn in the parent this branched at │
│  created_at, updated_at                                      │
│                                                              │
│  RELATIONSHIPS                                               │
│  ─────────────────────────────────────────────────────────  │
│  children[]  — sessions branched from this one               │
│  files[]      — attached documents, images                   │
│  chat[]       — the conversation thread                      │
│  practices[]  — code, Q&A, quiz attempts                    │
│  corrections[] — stored corrections applied to this node    │
│                                                              │
│  Correction {                                                 │
│    original_text,                                             │
│    corrected_text,                                            │
│    applied_to_message_id,                                     │
│    propagated_to_child_ids[],  ← user selects these          │
│    propagated: bool                                          │
│  }                                                           │
│                                                              │
│  GRAPH BEHAVIOR                                              │
│  ─────────────────────────────────────────────────────────  │
│  • Child can have ONE parent (tree) or MULTIPLE (DAG)        │
│  • Shared children: same node appears under multiple parents  │
│  • Propagating a correction to a shared child = one update  │
│  • Propagating a correction to a tree child = link preserved │
└──────────────────────────────────────────────────────────────┘
```
