Tasks follow `tdd-workflow-conventions`: the failing test precedes the code that satisfies it, and each group ends green. Backend work respects the layering rule `api → service → repository → models`; a task that reaches past a layer is a defect, not a shortcut.

This change lands after `account-identity`. Group 1 asserts that ordering before anything else is built on top of it.

## 1. Schema and migrations

- [ ] 1.1 Write a failing repository test that creating a project records its workspace, and that listing projects for one workspace excludes another workspace's projects
- [ ] 1.2 Add `models/project.py` with `ProjectRecord` (id, workspace_id, name, instructions, is_default, archived_at, created_at) and the project-source attachment record
- [ ] 1.3 Write a failing test asserting exactly one default project per workspace can exist, and that a second default insert for the same workspace is rejected
- [ ] 1.4 Add the partial unique index enforcing one default project per workspace
- [ ] 1.5 Generate the Alembic migration adding `projects` and the project-source attachment table, chained after the final `account-identity` migration
- [ ] 1.6 Add `project_id` (nullable), `archived_at`, and `archived_with_project_id` to `WorkspaceNodeRecord` and generate the migration — *`archived_at` and node archive/restore landed in `local-sessions-and-history` (revision `20261001_01`, `service/workspace.py:archive_node`/`restore_node`); verify against this change's specs rather than re-adding*
- [ ] 1.7 Write a failing test that running the full migration chain against a populated fixture database preserves every existing workspace, node, link, thread, message, anchor, and source
- [ ] 1.8 Write a failing test that backfill creates one default project per existing workspace and attaches every node to it, and a second failing test that a second run creates nothing further
- [ ] 1.9 Implement the backfill inside local data initialization, after migration and before workspace validation
- [ ] 1.10 Add the follow-up migration making `workspace_nodes.project_id` non-nullable

## 2. Project repository

- [ ] 2.1 Write failing repository tests: create, get by id within a workspace, list for a workspace, rename, and delete
- [ ] 2.2 Write a failing test that getting a project by an id belonging to a different workspace returns nothing, indistinguishably from an id that exists nowhere
- [ ] 2.3 Add `repository/project_repo.py` covering those operations, every one of them taking the workspace scope as a parameter
- [ ] 2.4 Write failing tests for node membership reads: list nodes of a project, and read one node's project
- [ ] 2.5 Extend `repository/` node queries with membership reads and a single `include_archived` filter parameter defaulting to excluded
- [ ] 2.6 Write a failing test that every exported node-listing repository function excludes archived nodes unless the flag is passed

## 3. Default project and membership invariant

- [ ] 3.1 Write a failing test that initializing a workspace creates its default project in the same transaction, so no workspace is ever observed without one
- [ ] 3.2 Implement default-project creation inside workspace initialization
- [ ] 3.3 Write a failing test that creating a node without naming a project attaches it to the workspace's default project
- [ ] 3.4 Write a failing test that creating a node naming a project of another workspace is refused as not found and creates no node
- [ ] 3.5 Implement membership assignment in `service/project_service.py` and wire node creation to it
- [ ] 3.6 Write failing tests that deleting the default project and archiving the default project are both refused, and the default project remains available afterwards
- [ ] 3.7 Implement those refusals

## 4. Moving nodes and crossing links

- [ ] 4.1 Write a failing test that moving a node changes only its membership: title, body, mode, threads, messages, anchors, and links are unchanged
- [ ] 4.2 Write a failing test that moving a node into the project it already belongs to succeeds and changes nothing
- [ ] 4.3 Write a failing test that moving a node into a project outside the active account's workspace is refused as not found and leaves membership unchanged
- [ ] 4.4 Implement the move in `service/project_service.py`
- [ ] 4.5 Write a failing test that a link between two nodes in different projects of one workspace is created, stored, and read back joining the same two nodes
- [ ] 4.6 Write a failing test that a node linked as a child of parents in two different projects keeps exactly one membership and is reachable from both parents
- [ ] 4.7 Write a failing test that moving a node with parent and child links preserves every one of those links
- [ ] 4.8 Confirm no containment check exists anywhere in link creation; if one was introduced, remove it and keep 4.5 through 4.7 green

## 5. Project identifiers in requests

- [ ] 5.1 Write a failing test for the project reference resolver: it resolves a project inside the derived workspace, and refuses a project from another workspace and a nonexistent project identically
- [ ] 5.2 Add the resolver alongside the existing scoping dependency, taking the derived scope rather than accepting a workspace from the caller
- [ ] 5.3 Write failing route tests that project routes refuse while no account is active, with the authentication-required signal rather than a not-found signal
- [ ] 5.4 Write failing route tests for create, list, rename, move-node, and delete, including that delete without the confirmation flag is refused
- [ ] 5.5 Add the project routes, obtaining every project reference through the resolver
- [ ] 5.6 Write a failing test that confirmed deletion of a project moves its nodes to the default project with content and links intact, and destroys no node

## 6. Archive and restore

- [ ] 6.1 Write failing tests that archiving a node sets its archived state and leaves title, body, mode, threads, messages, anchors, membership, and links unchanged — *`archived_at` and node archive/restore landed in `local-sessions-and-history` (revision `20261001_01`, `service/workspace.py:archive_node`/`restore_node`); verify against this change's specs rather than re-adding*
- [ ] 6.2 Write a failing test that restoring an archived node returns it to the unarchived state with all of that intact — *`archived_at` and node archive/restore landed in `local-sessions-and-history` (revision `20261001_01`, `service/workspace.py:archive_node`/`restore_node`); verify against this change's specs rather than re-adding*
- [ ] 6.3 Implement node archive and restore — *`archived_at` and node archive/restore landed in `local-sessions-and-history` (revision `20261001_01`, `service/workspace.py:archive_node`/`restore_node`); verify against this change's specs rather than re-adding*
- [ ] 6.4 Write a failing test that archiving a project holding unarchived nodes archives the project and every one of those nodes, and marks each as archived by that project
- [ ] 6.5 Write a failing test that a node archived individually beforehand is not marked as archived by its project
- [ ] 6.6 Write a failing test that the project cascade is atomic: a failure part-way leaves nothing archived
- [ ] 6.7 Implement project archive as one transaction
- [ ] 6.8 Write a failing test that restoring a project restores exactly the nodes it archived and leaves an individually archived node archived
- [ ] 6.9 Write a failing test that restoring a node whose project is still archived is refused with an indication that the project must be restored first
- [ ] 6.10 Implement project restore and the refusal
- [ ] 6.11 Write a failing test that moving a node out of an archived project clears its archived-by-project marker, leaves it individually archived, and that restoring the original project does not restore it
- [ ] 6.12 Implement that marker clearing in the move path
- [ ] 6.13 Write failing tests that archive and restore state survive a restart, including which nodes were archived by their project
- [ ] 6.14 Write a failing test that deleting an archived project or node requires the same explicit confirmation as deleting an unarchived one, and that no archive or restore destroys any record

## 7. Archive-aware listings, search, and bootstrap

- [ ] 7.1 Write failing tests that default node listings, the recency listing, and the canvas graph payload all exclude archived nodes — *`archived_at` and node archive/restore landed in `local-sessions-and-history` (revision `20261001_01`, `service/workspace.py:archive_node`/`restore_node`); verify against this change's specs rather than re-adding*
- [ ] 7.2 Write a failing test that archived projects are excluded from the project list used as move destinations
- [ ] 7.3 Implement the exclusions through the single repository filter added in 2.5
- [ ] 7.4 Write a failing test that search excludes archived nodes by default and includes them, marked as archived, when asked
- [ ] 7.5 Write a failing test that retrieval results remain confined to the active account's workspace when archived material is included, and that the same holds after `rebuild_workspace_index` runs
- [ ] 7.6 Implement archive filtering in search and retrieval at query time, leaving archived material in the index
- [ ] 7.7 Write a failing test that bootstrap returns a link whose other end is archived, together with a minimal descriptor of the archived node carrying identifier, title, and archived state and no body or conversation
- [ ] 7.8 Implement that in the bootstrap payload and bump its schema version

## 8. Project context layering

- [ ] 8.1 Write failing tests that a project's instructions appear in the assembled context of a node belonging to it and not of a node in another project
- [ ] 8.2 Write a failing test that clearing a project's instructions removes them from later assembly while account-wide instructions still apply
- [ ] 8.3 Write failing tests for ordering and attribution: instructions are emitted widest scope first, each labelled with its scope, and a nearer scope's instruction is presented as governing
- [ ] 8.4 Write a failing test that a wider scope's non-conflicting instructions are still present after a nearer scope adds its own
- [ ] 8.5 Implement instruction layering in the context-assembly service, computed at read time with nothing denormalized onto nodes
- [ ] 8.6 Write failing tests that account-wide and project sources are both available to a node's conversation, and that a source attached at two applicable scopes is made available exactly once
- [ ] 8.7 Write a failing test that detaching a source from a project stops it grounding that project's nodes, leaves the source in the workspace, and leaves other scopes' attachments intact
- [ ] 8.8 Implement source accumulation and de-duplication by source identity
- [ ] 8.9 Write a failing test that following a link into a node of another project assembles that node's own project context and not the linking project's
- [ ] 8.10 Write a failing test that a node linked to parents in two projects is governed by the project it belongs to, whichever parent it was reached from
- [ ] 8.11 Confirm assembly reads membership only and never reachability; keep 8.9 and 8.10 green
- [ ] 8.12 Write failing route tests for reading the applied context of an open node, showing each instruction and source with its scope and indicating where a nearer scope overrode a wider one
- [ ] 8.13 Implement that route

## 9. Frontend project surface

- [ ] 9.1 Write failing tests for a projects store: projects list, the default project, the membership of each node, and archive state
- [ ] 9.2 Add `features/projects/` with the store and its public `index.ts`
- [ ] 9.3 Write failing tests that the left rail groups recent nodes by project and lists no archived node
- [ ] 9.4 Implement the archive-aware, project-grouped recency listing
- [ ] 9.5 Write failing tests for left-rail search: archived results are excluded by default, appear marked as archived when the include control is on, and activating one opens the node without restoring it
- [ ] 9.6 Implement the include-archived control and the archived result marking
- [ ] 9.7 Write failing tests that project creation, moving the open node, and archiving or restoring a project are reachable without adding a fourth pane and without displacing the graph or the minimap
- [ ] 9.8 Implement the project management affordances inside the existing three panes
- [ ] 9.9 Write failing tests that the applied-context inspector names each instruction's and source's scope and indicates an override

## 10. Canvas grouping

- [ ] 10.1 Write failing tests that the canvas renders nodes of several projects in one graph, visually grouped, each group identified by its project, with no project chooser standing between the learner and the graph
- [ ] 10.2 Implement project grouping on the canvas
- [ ] 10.3 Write a failing test that a link between nodes in different projects is drawn as one directed connection crossing the two groups
- [ ] 10.4 Write a failing test that a node with parents in two projects is rendered once, inside the group of the project it belongs to, with a connection from each parent
- [ ] 10.5 Implement crossing-link rendering
- [ ] 10.6 Write failing tests that archived nodes get no card, that a rendered node linked to an archived node indicates a link to archived material, and that restoring through that indication draws the connection
- [ ] 10.7 Implement the archived-link indication and its restore offer

## 11. Selection branching inheritance

- [ ] 11.1 Write a failing test that a node generated from a selection without overrides inherits the source node's project alongside its mode, active skills, and MCP servers
- [ ] 11.2 Write a failing test that generating a node with a different project named creates the node in that project and still creates the link back to the source, crossing the two projects
- [ ] 11.3 Implement project inheritance and the override in the branch path
- [ ] 11.4 Write failing tests that both selection actions on an archived node's conversation create nothing and report that the node must be restored first
- [ ] 11.5 Implement that refusal

## 12. End-to-end happy path

- [ ] 12.1 Add an E2E test: create two projects, move a node into the second, branch a child from it into the first, and assert the canvas draws the crossing link in one graph
- [ ] 12.2 Add an E2E test: record project instructions, open a member node, and assert the applied-context inspector attributes them to the project scope and shows the account-wide instruction as overridden
- [ ] 12.3 Add an E2E test: archive a project, assert its nodes leave the canvas and the recency listing, find one by search with archived material included, restore the project, and assert exactly the cascaded nodes return

## 13. Documentation

- [ ] 13.1 Record in `CLAUDE.md` that a node belongs to exactly one project while a link may cross projects, and that any feature meaning "in this project" means membership and never reachability
- [ ] 13.2 Record that archive is a state and never a deletion, and that the archive filter lives at the repository boundary rather than at call sites
