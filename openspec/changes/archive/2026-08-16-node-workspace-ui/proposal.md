## Why

The mission names graph navigation as the product itself, but nothing exists to navigate in — the app renders a single static placeholder. The roadmap scatters the pieces of the working surface across Phase 3 (graph view), Phase 7 (node chat), Phase 8 (branching), and Phase 12 (practice), with no change defining the frame they share, so each phase would invent its own layout. This change fixes the frame first, and settles the one mechanic none of those phases describe: branching from a text selection inside a conversation.

## What Changes

- **BREAKING**: The Phase 1 placeholder stops being the root view. The three-pane workspace replaces it; the backend status indicator relocates into the workspace chrome rather than disappearing.
- A three-pane workspace shell: a recents/search rail on the left, a graph-or-node center, and a right rail stacking a graph minimap over the practice tools.
- The graph owns the center by default. Entering a node moves that node's conversation into the center and slides the graph into the right rail as a minimap, so the learner never loses spatial position.
- Selecting text in any message raises a two-action affordance: **generate a node** (a new session, visible in the graph) or **new chat** (an additional thread on the current node, invisible to the graph).
- Both actions capture the same `SelectionAnchor` — `message_id`, `start`, `end`, and a copy of the selected `excerpt`. The excerpt copy is what lets a branch survive its source message being rewritten by a correction or collapsed by compaction.
- A node becomes a container for one or more conversation threads rather than exactly one conversation. Every node opens with a `main` thread; spawned threads render as a collapsed stub at their anchor and expand into the center with a back-link to their origin. Threads may spawn further threads.
- The left rail is scoped as a recents-and-search index over nodes, explicitly not a chat list, and never lists threads.

## Capabilities

### New Capabilities

- `node-workspace-layout`: The three-pane shell — pane responsibilities and boundaries, the graph-owns-center default, the enter-node transition that demotes the graph to a minimap, right-rail stacking, and the constrained-height breadcrumb fallback.
- `selection-branching`: The text-selection affordance, the two branch actions and what each constructs, the `SelectionAnchor` shape, and anchor resolution and staleness behavior when a source message changes.
- `node-chat-threads`: Threads as node-internal conversations — the `main` thread, stub rendering at the anchor, expansion into the center with a back-link, nested spawning, and the rule that threads never surface in the left rail or the graph.

### Modified Capabilities

- `phase-one-placeholder-ui`: The requirement that the window render a single placeholder screen as its visible content no longer holds — the workspace shell becomes the root view. The `/health` status indicator requirement is retained but re-homed into the workspace chrome.

## Impact

**Frontend** — the affected surface. All new code lands in existing scream-architecture feature directories, so no structural change to `frontend-scream-architecture` is required:

| Area | Change |
|---|---|
| `features/graph-navigation/` | Left rail (recents/search), center canvas, right-rail minimap, center↔minimap transition |
| `features/node-chat/` | Node conversation view, selection affordance, thread stubs and expansion |
| `features/practice/` | Right-rail tool tabs (Q&A / Code / Quiz) as containers only — contents are Phase 12 |
| `app/App.tsx`, `app/routes/` | Workspace replaces `Placeholder` as the root view |
| `app/Placeholder.tsx` | Removed; its `/health` indicator moves into workspace chrome |

**Backend** — none in this change. The data model this UI requires is a dependency on the Phase 2 change, recorded in `design.md`: `ChatThread`, `ChatMessage.thread_id`, `SelectionAnchor` on both the node edge and `ChatThread`, `Node.fork_point` replaced by a `SelectionAnchor`, and `CompactionStep` keyed by `thread_id`. Until Phase 2 lands, the workspace renders against fixture data.

**Dependencies** — no new packages. `react-force-graph` (graph + minimap) and Tailwind are already committed in `tech-stack.md`.

**Open, and blocking Phase 2 rather than this change** — whether `Link` or `Node.parent_id` is the graph's source of truth. Phase 9's shared-child correction propagation requires the DAG that a single `parent_id` cannot express; if `Link` wins, the selection anchor belongs on the edge.
