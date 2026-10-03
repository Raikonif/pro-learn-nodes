## 1. Backend: data

- [x] 1.1 `models/project.py` (`ProjectRecord`); `WorkspaceNodeRecord.project_id`, `archived_with_project_id`; `AgentSessionRecord.project_context`
- [x] 1.2 Migrations `20261006_01` (projects table, partial unique default index, `agent_sessions.project_context`), `20261006_02` (nullable `project_id` + marker, default project "General" per workspace, backfill, idempotent), `20261006_03` (non-null); migration tests pinned to their revisions: backfill, idempotence, links/threads/messages unchanged, downgrade
- [x] 1.3 `ensure_default_workspace` creates the default project with the workspace; `repository/project_repo.py`

## 2. Backend: projects and archive

- [x] 2.1 `service/projects.py`: `resolve` (foreign and missing refused identically), create, rename, set instructions, list archived with node counts
- [x] 2.2 Membership: root creation takes optional `projectId` (default project otherwise), branch creation takes optional override (source's project otherwise), child creation inherits; move node; archived target refused
- [x] 2.3 Archive project (one transaction, marker only on nodes not already archived), restore project (exactly the marked nodes), node restore refused while its project is archived, moving out of an archived project clears the marker; default project refused
- [x] 2.4 Delete project: members (archived or not) move to the default project, marker cleared, `archived_at` kept; default refused
- [x] 2.5 Bootstrap: `projects`, `projectId` per node, `archivedLinks`; routes per design "Wire contract"; route tests including cross-account refusal and atomicity of the archive cascade

## 3. Backend: instructions reach the agent

- [x] 3.1 `TurnService`: project instructions block on a new agent session (after orientation, before origin), a one-time update block when the recorded `project_context` differs, nothing otherwise; record what was sent; tests with `FakeAgent` (new session, unchanged, edited, moved, emptied, membership-not-reachability)
- [x] 3.2 Context server `current_session` reports `project: {name, instructions}`; test

## 4. Frontend: store and wire

- [x] 4.1 `workspace-types`/`workspace-api`: projects, `projectId`, `archivedLinks` (tolerant of their absence); project route clients
- [x] 4.2 `workspace-store`: project actions, `projectFilter` persisted per device, archived-projects read; tests

## 5. Frontend: surfaces

- [x] 5.1 `features/projects/`: project filter above the history; management menu (new, rename, instructions editor dialog, archive, delete with a confirmation naming the outcome; default project's archive/delete absent with the reason); archived-projects list with restore
- [x] 5.2 History: filter by project, project chip per entry while showing all; "Move to project…" per entry; restoring a session of an archived project shows the refusal
- [x] 5.3 Session header names the project and opens its instructions; the detailed start offers a project picker
- [x] 5.4 Canvas: labelled region per project behind its cards; links unchanged; "linked to N archived" on cards with `archivedLinks`, listing them with Restore
- [x] 5.5 `command-surface` projects contributor: show project / all projects, new project, move session to a project (unavailable without an open node; archived projects absent)
- [x] 5.6 Component tests for 5.1–5.5

## 6. Verification

- [x] 6.1 E2E `projects.spec.ts`: create a project, start a session in it, filter, move a session, cross-project branch keeps its link, project instructions reach the fake agent (`whoami`/prompt echo), archive the project (sessions leave history and canvas), restore exactly, delete moves sessions to the default
- [ ] 6.2 Full suites green; rebuild sidecar and bundle; in the built app, create a project with instructions, chat in it, archive and restore it
