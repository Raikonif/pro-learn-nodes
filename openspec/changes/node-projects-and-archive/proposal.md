## Why

A learner's graph has no grouping and no way to retire anything. Every node sits in one undifferentiated workspace, instructions and sources can only be set account-wide, and the sole way to get a finished line of study off the canvas is to delete it — which destroys the branches that grew out of it. Past a few dozen nodes the canvas becomes the thing the learner avoids rather than the thing they navigate, which defeats the mission's central claim that graph navigation *is* the product.

The obvious fix — folders that contain their nodes — is the one the mission forbids: a node reachable from parents in two different groups is exactly the shared-child DAG the product exists to express, and strict containment makes it inexpressible. This change introduces grouping that carries context without severing links, and retirement that is a state rather than a loss.

## What Changes

- Add a `Project` record scoped to one workspace, which is owned by one profile. A project is never global and never spans accounts.
- Make project membership **total and exclusive**: every node belongs to exactly one project, and every workspace has an implicit **default project** that receives nodes for which no project was chosen. Membership is never absent, so no query needs an "unassigned" branch.
- Permit a **node link to cross project lines**. Links are neither blocked, rewritten, nor severed when the nodes they join belong to different projects. This is the deliberate divergence from the containment model.
- Give projects **instructions** and **attached sources** that apply to every node whose membership is that project, layered over the account-wide equivalents. Where the two conflict, the nearer scope governs; sources accumulate across scopes.
- Decide applicability by **membership, not reachability**: a node reached by following a link out of another project is governed by its own project's instructions, never by the linking project's.
- Add **archive** as a state on a project and on a node. Archived material leaves the canvas, the left rail's recency listing, and every default listing, while remaining findable by explicit search, openable from those results, and restorable to exactly its prior state.
- Archiving a project archives the nodes it holds, recording which nodes were archived as a consequence, so restoring the project restores exactly those and does not resurrect nodes that were archived on their own beforehand.
- Keep **deletion separate and confirmed**, mirroring how account removal is separated from sign-out. Archiving never destroys anything; deleting a project never implicitly deletes its nodes.
- Follow `profile-scoped-data-access`: a request never supplies the workspace it operates on, and a project identifier a request does supply is honoured only after it is confirmed to belong to the active account's workspace. A project belonging to another account and a project that does not exist are refused identically.
- **BREAKING**: node creation and node listing responses gain a required project membership, and default node listings exclude archived material. A client that renders every returned node as a canvas card without consulting archive state will show a workspace it should not.
- Canvas renders project membership as grouping **within one graph**, not as one graph per project. A cross-project link stays drawn.

## Capabilities

### New Capabilities

- `node-projects`: Project records scoped to a workspace, total and exclusive node membership with an implicit default project, moving nodes between projects, links that cross project lines, and server-side confirmation of any project identifier a request names.
- `project-context-layering`: Project-level instructions and attached sources, how they layer over account-wide equivalents, the nearest-scope-wins precedence rule, and the rule that membership rather than reachability decides which instructions govern a node.
- `workspace-archive`: Archive as a restorable state on projects and nodes — what archiving removes from view, what it preserves, how it cascades from a project to its nodes and back, and how it stays distinct from deletion.

### Modified Capabilities

- `local-workspace-persistence`: persisted relationships gain project membership as an invariant — every node belongs to exactly one project in its own workspace, while a link may join nodes in different projects — and archive state is durable across restarts.
- `react-flow-node-canvas`: the canvas renders project membership as grouping within a single graph rather than a graph per project, continues to draw links that cross projects, and omits archived nodes.
- `node-workspace-layout`: the left rail's recency listing and search account for projects and archive state — archived nodes are excluded from recents but reachable through search.
- `selection-branching`: a node generated from a selection inherits the source node's project alongside its mode, skills, and MCP servers, and an override at creation produces a permitted cross-project link.

## Impact

- **Backend**: new `models/project.py`; `WorkspaceNodeRecord` gains a non-nullable project membership and an archive state; `repository/project_repo.py`; `service/project_service.py`; project routes under `api/routes/`; context assembly in `service/` gains the scope-layering step. Alembic migrations add `projects`, create a default project per existing workspace, backfill every node's membership, then tighten the column to non-nullable.
- **Frontend**: new `features/projects/` public surface; `features/graph-navigation/` renders grouping and omits archived nodes; the left rail gains an archive-aware recency listing and an archived-results affordance in search.
- **Depends on**: `account-identity` — projects hang off a workspace that a profile owns, and the scoping rule established there is the one project identifiers follow.
- **Deferred**: project-level skill and MCP defaults (they belong with the skills and MCP phases), sharing or exporting a project as a unit, and nesting one project inside another.
