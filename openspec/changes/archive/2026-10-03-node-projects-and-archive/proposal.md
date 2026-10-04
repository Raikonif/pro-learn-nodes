## Why

A learner's graph has no grouping. Every session sits in one undifferentiated history and canvas, instructions can only be given turn by turn, and the only way to put a finished line of study away is to archive its sessions one at a time. Past a few dozen sessions the canvas becomes something the learner avoids rather than navigates.

The obvious fix — folders that contain their nodes — is the one the mission forbids: a node reachable from parents in two groups is the shared-child DAG the product exists to express. This change adds grouping that carries context without severing links, and lets a whole project be put away and brought back exactly.

This revision updates the August draft to the application as it now stands: sessions are already archived rather than deleted (`session-history`), nodes run on ACP agents that receive context through their prompt and the local MCP server, and there are no account-wide instructions or attached sources to layer projects over.

## What Changes

- Add a **project** scoped to the active account's workspace. Every node belongs to exactly one project; every workspace has a **default project** that receives nodes with no chosen project and can be renamed but not archived or deleted.
- **Links may cross projects.** Nothing refuses, rewrites, or severs a link because its ends are in different projects; moving a node changes only its membership.
- **Project instructions reach the node's agent.** A project may hold instructions. Every new agent session for a node of that project receives them, labelled with the project, in its first prompt; when they change, or the node moves to another project, the next turn carries the update once. The agent can also read them through the context server's `current_session`. Membership, never reachability, decides which project's instructions apply.
- **Archiving a project** archives its unarchived nodes and records which ones it took, so restoring the project restores exactly those. A node archived on its own stays archived. Restoring a node whose project is archived is refused until the project is restored. Session archiving itself is unchanged.
- **Deleting a project** is separate and confirmed, and moves its nodes to the default project; it never deletes a node. Sessions remain undeletable, as `session-history` requires.
- **Left rail:** a project filter above the history (All projects, or one), a "Move to project…" action per session, project management (new, rename, instructions, archive, delete), and an archived-projects list to restore from. The day grouping, previews, and search stay as they are.
- **Canvas:** one graph with each project drawn as a labelled region behind its cards; crossing links stay drawn; a node linked to an archived node says so and offers to restore it.
- **Branching** inherits the source node's project; a new session from the detailed start can choose its project.
- **Palette:** project commands (filter to a project, new project, move the open session to a project) join the command registry.
- **BREAKING (wire):** nodes in the bootstrap carry `projectId`; the graph carries `projects`.

## Capabilities

### New Capabilities

- `node-projects`: projects, exclusive membership, the default project, crossing links, moving, branching inheritance, deleting a project, server-side confirmation of a named project, and how projects are reached in the workspace.
- `project-instructions`: a project's instructions, how and when they reach the node's agent, and how the learner sees which project governs a session.
- `workspace-archive`: archiving and restoring a project, the recorded cascade to its nodes, the interaction with individually archived nodes, and links whose other end is archived.

### Modified Capabilities

- `local-workspace-persistence`: every node belongs to exactly one project of its workspace, links may join projects, and projects and archive state persist.
- `react-flow-node-canvas`: archived nodes are not rendered; projects are grouped within one graph; crossing links are drawn; links to archived material are indicated.
- `node-workspace-layout`: the left rail gains the project filter and project management without changing its history and search.
- `selection-branching`: a generated node inherits the source node's project unless the learner names another.

## Impact

- **Backend:** `models/project.py`; `WorkspaceNodeRecord.project_id` (non-null after backfill) and `archived_with_project_id`; `AgentSessionRecord.project_context` (what the agent was last told); `repository/project_repo.py`; `service/projects.py`; routes in `api/routes/workspace.py`; `TurnService` adds project instructions to the prompt; the context server's `current_session` reports the project. Three Alembic revisions (table, nullable column + backfill, non-null).
- **Frontend:** `features/projects/` (filter, management, move, archived list); `workspace-store` project actions; `graph-navigation` canvas regions and archived-link indication; `study-launcher` project choice; `command-surface` project contributor.
- **Depends on:** `command-palette-and-skill-commands` being applied for the palette contributor (it is, though not yet archived).
- **Deferred:** account-wide and node-level instructions, sources attached to a project, project-level agent defaults, nesting projects, exporting a project.
