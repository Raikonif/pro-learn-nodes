## Context

See `proposal.md - Why`. The current state that shapes the approach:

- `WorkspaceNodeRecord` already has `archived_at` (from `local-sessions-and-history`); `service/workspace.py` has `archive_node` / `restore_node`, the bootstrap omits archived nodes, and `search_sessions(..., include_archived)` returns archived sessions for restore. Sessions are never deleted.
- `NodeLinkRecord` is a row of its own (`parent_id`, `child_id`, `anchor_id`), so a link crossing projects needs nothing new.
- Scope is derived server-side (`api/dependencies/auth.py`); services receive a `workspace_id` that never comes from the client.
- Workspace mutations return the bootstrap snapshot (`{"graph": ...}`), which the frontend store replaces wholesale.
- Agent context: `TurnService` (`service/agent/sessions.py`) builds the prompt — orientation note on a new agent session, branch origin, command instruction, replay or catch-up, then the learner's text — and keeps one `AgentSessionRecord` per (thread, agent). The context server's `current_session` tool tells the agent about the session it is in.
- The latest Alembic revision is `20261005_01`.

## Goals / Non-Goals

**Goals**
- One column records a node's group; nothing in the graph is asked to respect it.
- No "unassigned" branch anywhere: the default project is a row.
- Archiving a project is exactly reversible.
- Project instructions reach the agent without a second channel the learner has to keep in sync.

**Non-Goals**
- Account-wide or node-level instructions, sources attached to a project, project-level agent defaults, nesting, exporting.
- Deleting sessions (still archive-only).
- Opening an archived session without restoring it (today a search result offers restore, and that stays).

## Decisions

### Membership is one non-null column on the node
`workspace_nodes.project_id` → `projects.id`. A join table would let a node be in two projects and make "which instructions govern this node" ambiguous; the crossing link already gives the shared-child case what it needs.

### A link may cross projects, and nothing enforces containment
No code compares the two ends' `project_id`. "In this project" always means membership, never reachability — the instructions rule below is the first place that matters.

### The default project is a real row
Created with the workspace (and by the backfill for existing workspaces). It can be renamed; archiving or deleting it is refused with a reason naming what it is for. A partial unique index on `(workspace_id) WHERE is_default = 1` holds the "exactly one" rule in the database.

### A named project is confirmed against the derived scope
Routes accept a `projectId` and resolve it through one helper, `projects.resolve(workspace_id, project_id)`, which raises the same not-found for a foreign and a nonexistent id.

### Archive reuses `archived_at`; the cascade is recorded
`projects.archived_at` is new; nodes keep their existing `archived_at` and gain `archived_with_project_id`. Archiving a project, in one transaction: stamp the project; for each member node with `archived_at IS NULL`, set `archived_at` and `archived_with_project_id`. Restoring: clear the project and exactly the nodes carrying its marker. Restoring an individual node clears its marker too, and is refused (422, "Restore the project <name> first") while its project is archived. Moving a node out of an archived project clears its marker and leaves `archived_at`, making it individually archived.

*Alternative:* derive node archive state from the project. Rejected: every listing would join `projects`, and "archived on its own inside an archived project" would be unrepresentable.

If the open node is archived with its project, the frontend closes it (the snapshot no longer contains it), as archiving the open session does today.

### Deleting a project moves its nodes
`DELETE` moves every member node (archived or not) to the default project, clearing `archived_with_project_id` and keeping `archived_at`, then deletes the row. Never deletes a node.

### Project instructions are part of the prompt, tracked per agent session
`AgentSessionRecord` gains `project_context` (JSON: `{"projectId", "name", "instructions"}` as last told to that agent session, or null). On each turn `TurnService` computes the node's current project context:

- **New agent session** (fresh): if the project has non-empty instructions, a block `Project "<name>" instructions:\n<instructions>` follows the orientation note and precedes the branch origin; record what was sent.
- **Existing session, context changed** (instructions edited, node moved, project renamed): a block `The project for this session is now "<name>". Its instructions:\n…` (or `…It has no instructions.`) is sent once before the learner's text; record it.
- **Unchanged:** nothing is added.

Prompt order becomes: orientation, project instructions (new session) or project update, origin, command instruction, replay/catch-up, text. The context server's `current_session` adds `project: {name, instructions}`.

*Alternative:* MCP only. Rejected: measured agents call `current_session` when they think they need context, not reliably on every session; instructions are directives and must be in the prompt.

### Wire contract
Bootstrap (`GET /workspace/bootstrap`) `graph` gains:
- `projects`: unarchived projects `{id, name, instructions, isDefault, createdAt}`, default first then by `createdAt`.
- every node: `projectId`.
- `archivedLinks`: for each link with exactly one archived end, `{nodeId, archivedNodeId, archivedTitle}` where `nodeId` is the unarchived end.

Routes (scope derived; mutations return `{"graph": <bootstrap graph>}`):

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/workspace/projects` | `{name}` | 422 on empty name |
| PATCH | `/workspace/projects/{id}` | `{name?, instructions?}` | renaming the default is allowed |
| POST | `/workspace/projects/{id}/archive` | — | 422 for the default project |
| POST | `/workspace/projects/{id}/restore` | — | |
| DELETE | `/workspace/projects/{id}` | — | 422 for the default; nodes → default |
| GET | `/workspace/projects/archived` | — | `{projects: [{id, name, archivedAt, nodeCount}]}` |
| PUT | `/workspace/nodes/{id}/project` | `{projectId}` | archived project as target → 422 |

Existing creation routes accept an optional `projectId`: root creation (default project when absent), branch creation (source node's project when absent). Child creation inherits. Archived target project → 422.

### Frontend shape
- `workspace-store` gains the project actions above and `projectFilter: string | null` (view state, persisted per device in local storage like the pane layout).
- `features/projects/` holds the filter, the management menu (new, rename, instructions editor, archive, delete with a confirmation naming the outcome), "Move to project…" (a menu of unarchived projects), and the archived-projects list.
- The history (`RecentsRail`) filters by `projectFilter` and shows a project chip per entry while showing all projects. Search is not filtered by project.
- The canvas draws, per project with rendered nodes, a labelled rounded rectangle behind its cards (computed from the cards' laid-out bounds, rendered as a non-interactive React Flow node at the lowest z-index). Links are unchanged. A card with entries in `archivedLinks` shows "linked to N archived"; activating lists them with Restore.
- The session header names the node's project and opens its instructions.
- The detailed start offers a project picker (preselected: the filter's project, else default).
- `command-surface` gains a projects contributor: `Show project: <name>` (sets the filter), `Show all projects`, `New project`, and `Move session to <name>` (needs an open node).

## Risks / Trade-offs

- **A drawn crossing edge can read as membership.** → Regions are drawn strictly by membership and edges pass through region boundaries; the header names the governing project.
- **Archiving a big project is a bulk write.** → One transaction; a test asserts a failure mid-way archives nothing.
- **Deleting a project surprises a learner who expected the work to go.** → The confirmation states that sessions move to the default project.
- **Backfill against real data.** → Split migrations (nullable → backfill → non-null); `backup_database` runs first; backfill is idempotent and tested.
- **Region layout overlaps when projects interleave in the tree layout.** → Accepted for now: regions may overlap; labels stay readable. Layout by project is a later refinement.
- **Instruction updates cost tokens each time they change.** → Sent once per change per agent session, never repeated.

## Migration Plan

1. `20261006_01_projects`: create `projects` (`id`, `workspace_id` FK, `name`, `instructions` default '', `is_default`, `archived_at`, `created_at`) with the partial unique index; add `agent_sessions.project_context` (JSON, nullable).
2. `20261006_02_node_projects`: add nullable `workspace_nodes.project_id` (indexed) and `archived_with_project_id`; create one default project ("General") per workspace lacking one; set every null `project_id` to it. Idempotent.
3. `20261006_03_node_project_required`: make `project_id` non-null (batch alter, preserving existing indexes).

Rollback: the timestamped backup `backup_database` writes before migrating; between steps 2 and 3 the schema tolerates nulls.
