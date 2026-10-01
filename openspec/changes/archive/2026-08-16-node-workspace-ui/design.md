## Context

The mission frames graph navigation as the product itself (`mission.md` Principle 2), but no shell exists to navigate in. Phase 1 shipped a placeholder screen; there is no layout, no node view, no chat surface. The roadmap distributes the pieces across Phase 3 (graph view + nav tabs), Phase 7 (node chat), Phase 8 (branching), and Phase 12 (practice panel), with no change that defines the frame they all live in.

This change defines that frame: a three-pane workspace modeled on the Codex app layout, with one deliberate departure — the center belongs to the node graph and to node conversations, not to a flat chat.

It also introduces a mechanic the roadmap does not currently describe: **selecting text inside a conversation and branching from that selection**, either into a new node (visible in the graph) or into a new thread inside the current node (invisible to the graph).

The scream architecture already has homes for all three panes:

| Pane   | Feature directory                    |
|--------|--------------------------------------|
| Left   | `features/graph-navigation/` (recents/search rail) |
| Center | `features/graph-navigation/` (canvas) + `features/node-chat/` |
| Right  | `features/graph-navigation/` (minimap) + `features/practice/` |

## Goals / Non-Goals

**Goals:**

- A three-pane workspace shell: history/search rail, node-or-graph center, minimap-over-tools right rail
- The graph owns the center by default; entering a node moves the chat into the center and slides the graph into the right rail as a minimap
- Selecting text in any message offers exactly two actions: generate a node, or start a new in-node thread
- Threads spawned from a selection are addressable, resumable, and can themselves spawn further threads
- Every branch — node or thread — carries a durable anchor back to the text it came from

**Non-Goals:**

- The data model backing this. `ChatThread`, `ChatMessage.thread_id`, and the selection anchor columns are specified here as **requirements on Phase 2**, not implemented by this change (see Dependencies).
- Correction propagation UI (Phase 9), compaction drill-down UI (Phase 10), memory panel (Phase 11)
- The study launcher full-window entry point (Phase 13)
- Provider configuration, skills toggles, MCP settings surfaces (Phases 4–6)
- Keyboard shortcuts and dark mode (Phase 14)

## Decisions

### 1. A "new chat" is a thread inside the node, not a second class of session

`mission.md:48` states that sessions and nodes are the same thing. A conversation that is not a node would contradict that, and a persisted list of non-node chats in the left rail would contradict the "not a chat list" anti-goal (`mission.md:63`) directly.

Instead, a node is a session **container** holding one or more conversation threads. Every node opens with a `main` thread. Selecting text and choosing "new chat" creates an additional thread on the same node.

```
  Node: Haskell                      Graph sees:
   ├── main thread
   │     └─ msg#7 ─anchor─▶ thread "thunks"        ╭────────╮
   │                          └─ msg#3 ─anchor─▶     │ Haskell│
   │                               thread "leaks"   ╰────────╯
   └──                                              (one node)
```

Consequences:

- `ChatMessage` gains a `thread_id`. A thread belongs to exactly one node.
- Principle 1 survives: the conversation still lives in a node.
- The left rail stays a pure index over nodes. Threads are node-internal and never appear in it.
- **Thread lineage needs no parent column.** Every message belongs to a thread, and every spawned thread stores an anchor pointing at a message. The thread tree is derivable from the anchors alone.

Rejected: *scratch chats* (ephemeral, ungraphed, unpersisted) — loses work with no recovery path and reintroduces a second history. Rejected: *draft nodes* (everything is a node, unpromoted ones render dimmed) — simplest backend, but fills the graph with ghosts and needs a decay policy this change does not want to own.

### 2. One anchor shape, two destinations

Both selection actions need the identical payload. They differ only in what they construct.

```
                    ┌──────────────────────────────┐
   text selection ──▶│  SelectionAnchor             │
                    │  · message_id                │
                    │  · start, end                │
                    │  · excerpt (copied text)     │
                    └───────────┬──────────────────┘
                ┌───────────────┴───────────────┐
                ▼                               ▼
      ⬡ GENERATE NODE                  ○ NEW THREAD
      new Node + graph edge            new ChatThread on this node
      inherits mode/skills/MCP         invisible to the graph
      appears in the graph             stub renders at the anchor
```

`excerpt` is load-bearing, not denormalization for speed. Phase 9 corrections rewrite message text and Phase 10 compaction collapses older turns; character offsets rot against both. Storing the selected text means a branch survives its own source being edited out from under it. On resolution failure, the UI falls back to the excerpt and marks the anchor stale rather than breaking the branch.

### 3. The graph owns the center and yields to the node

```
DEFAULT — graph owns the center
┌────────────┬──────────────────────────────────────┬─────────────┐
│  recents   │            ◉ GRAPH                   │             │
│  search    │        ╭─────╮                       │   (idle)    │
│            │        │ FP  │                       │             │
│  · Haskell │      ╭─┴──┬──┴─╮                     │             │
│  · Monads  │   ╭──┴──╮ │ ╭──┴──╮                  │             │
│  · Cat Th. │   │Hask │ │ │CatTh│                  │             │
│            │   ╰──┬──╯   ╰──┬──╯                  │             │
│            │      ╰────┬────╯                     │             │
│            │        ╭──┴───╮                      │             │
│            │        │Functr│ ⇄ shared             │             │
│            │        ╰──────╯                      │             │
└────────────┴──────────────────────────────────────┴─────────────┘
                   click / generate a node
                              ▼
ENTERED — chat takes center, graph slides right as minimap
┌────────────┬──────────────────────────────────────┬─────────────┐
│  recents   │  ╔═ Haskell ══════════ Deepen ═════╗ │ ╭─────────╮ │
│  search    │  ║ AI: Haskell defers evaluation   ║ │ │ ·  ●  · │ │
│            │  ║     until a value is ▓▓▓▓▓▓▓▓   ║ │ │  ╲ │ ╱   │ │
│  · Haskell │  ║     needed. Thunks ▓▓▓▓▓▓▓▓▓▓   ║ │ │   ◉ you │ │
│  · Monads  │  ║        ┌──────────────────┐     ║ │ ╰─────────╯ │
│  · Cat Th. │  ║        │ ⬡ Generate node  │     ║ ├─────────────┤
│            │  ║        │ ○ New chat       │     ║ │ Q&A │ Code  │
│            │  ║        └──────────────────┘     ║ │  >>> run    │
│            │  ╚═════════════════════════════════╝ │             │
│            │  [ ask...                       ] ➤  │             │
└────────────┴──────────────────────────────────────┴─────────────┘
```

The graph is never dismissed — it is demoted to a minimap that keeps the learner's position visible. This is what "graph navigation IS the product" means concretely: the map stays on screen while you are in a place.

The left rail is therefore a **recents and search index**, not the primary navigation. Navigation happens in the graph. This is what keeps it from becoming the chat list the anti-goals forbid.

### 4. Right rail stacks the minimap over the practice tools

Minimap pinned at a fixed height on top; `Q&A / Code / Quiz` tabs fill the remainder.

Rejected: making the graph a peer tab alongside Q&A/Code/Quiz. Selecting a tab to see the graph defeats the reason for sliding it right — a hidden map provides no orientation. Rejected: giving the graph the full right rail and moving practice to a bottom drawer — costs vertical space in the center, where the conversation lives.

When vertical space is constrained, the minimap collapses to a breadcrumb strip (`FP › Haskell › ▸`) that expands on hover.

### 5. Threads render as an inline stub that expands into the center

```
  AI: ...until a value is ▓▓▓▓         ┌────────────────────┐
      needed. Thunks are...    click   │ ◂ from: "Thunks…"  │
      ╰─▸ thunks (4) ▸  ───────────▶   │ You: what's a thunk│
                                       │ AI: an unevaluated…│
                                       └────────────────────┘
```

A collapsed stub sits at the anchor showing the thread name and message count, preserving the visual link to its origin. Clicking expands the thread into the center with a `from: "…"` back-link header that returns to the anchor.

Rejected: fully inline nesting — strongest provenance, but a 40-turn side thread nested under a message is unreadable, and nesting compounds since threads spawn threads. Rejected: peer tabs across the node header — plenty of room, but the connection to the originating text is lost, which is the entire point of anchoring to a selection.

### 6. A thread inherits the node's configuration and cannot override it

Threads run with the owning node's mode, active skills, and MCP servers. No per-thread configuration controls exist.

This is what keeps the two branch actions meaningfully distinct. If a thread could differ from its node in every respect, there would be no reason for it not to be a node — and the graph would be the poorer for hiding it. Configuration is the property that makes something a session; a thread is a tangent within one.

Rejected: full per-thread override mirroring Phase 8's node-branching controls — flexible, but it adds a config affordance to every thread and erases the line this change is drawing. Rejected: mode-only override (switch a passage from Deepen to Quiz while sharing skills and MCP) — plausibly the real use case and cheap, but it is additive later; shipping without it keeps the first version's surface honest.

### 7. The graph renders as SVG here; `react-force-graph` waits for Phase 3

`tech-stack.md` commits to `react-force-graph` for the spatial canvas, and `roadmap.md` Phase 3 is where that canvas is scheduled. This change is the frame, not the canvas, so it renders the graph as SVG with a deterministic layout and leaves the force-directed view to the phase that owns it.

The deciding factor is testability. `react-force-graph` draws to canvas/WebGL and does not run under jsdom, so every graph assertion in this change would be made against a mock — "every fixture node renders" would verify the mock, not the rendering. SVG gives real elements, real accessible names, and real click targets, and the same component serves both the center canvas and the right-rail minimap at two sizes.

Neither dependency was actually installed when implementation began; only `zustand` was added.

Rejected: installing `react-force-graph` now and mocking it — matches the tech stack sooner at the cost of hollow tests, and the minimap needs a separate implementation regardless. Rejected: force-graph in the center, SVG in the minimap — two graph implementations to hold in sync for one change's benefit.

## Dependencies

This change specifies UI behavior. It requires the following from the Phase 2 data model change, which does not exist yet:

| Requirement | Current roadmap/tech-stack state |
|---|---|
| `ChatThread` entity, `1..N` per node, one `main` per node | Not present — no thread concept |
| `ChatMessage.thread_id` | Not present |
| `SelectionAnchor` (`message_id`, `start`, `end`, `excerpt`) on both the node edge and `ChatThread` | Not present |
| `Node.fork_point` replaced by a `SelectionAnchor` | `fork_point (int)` — a turn index, too coarse to address a text selection, and it drifts under correction and compaction |
| `CompactionStep` keyed by `thread_id` rather than `node_id` | Keyed by `node_id`; the `level` enum's `node` tier likely becomes `thread` |

Threads are assembled and sent to the provider independently, so compaction is necessarily per-thread.

## Open Questions

- **Link vs `parent_id` as the graph's source of truth.** `roadmap.md:38` gives `Node` a single nullable `parent_id`, which cannot express the shared-child DAG that `mission.md:98` and the outline diagram both show. Phase 9 requires it ("if a node appears under multiple parents, each parent's correction shows in that child's propagation list"). If `Link` becomes the source of truth, the selection anchor belongs on the edge, not on the node. **Blocks Phase 2's schema; does not block this change's UI specs.**
- **What context does a spawned thread receive?** The excerpt alone, the excerpt plus everything preceding the anchor in the source thread, or those plus the node body. The same question applies to node branching (Phase 8's "include parent's compacted summary" checkbox), and the two answers should agree.
*(Resolved: threads inherit the node's mode, active skills, and MCP servers with no override — see Decision 6.)*
