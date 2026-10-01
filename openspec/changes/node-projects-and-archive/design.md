## Context

See `proposal.md - Why` for motivation. The relevant current state:

- `models/workspace.py` holds nine tables, every one of them carrying `workspace_id`. `WorkspaceNodeRecord` has no grouping column and no lifecycle state; a node is either present or deleted.
- `NodeLinkRecord` is a first-class row with `parent_id`, `child_id`, and an optional `anchor_id` — the link is already independent of the two nodes it joins, which is what makes a crossing link cheap to express and a containment rule expensive to enforce.
- `account-identity` establishes that a request never names its workspace: `api/dependencies/auth.py` resolves active session → profile → workspace and injects the scope, and services keep receiving a `workspace_id` that no longer originates with the client. This change inherits that dependency rather than adding a second scoping path.
- `service/retrieval.py` maintains a `source_chunk_fts` projection filtered by `workspace_id`, rebuildable through `rebuild_workspace_index()`.
- `core/migrations.py:backup_database` takes a timestamped copy before every migration, so every migration below has a rollback point already written.

Constraints: the mission's shared-child DAG must stay expressible (principle 11 and the data-model diagram); the canvas must stay one graph rather than one graph per project; nothing archived may be lost; and this change must land after `account-identity`, because a project hangs off a workspace that a profile owns.

## Goals / Non-Goals

**Goals**

- Grouping that carries context without constraining topology — one place where a node's group is recorded, and no place where the graph is asked to respect it.
- A membership column that never needs an "unassigned" branch in any query, now or later.
- Archive as a state that a single filter expresses, applied in one place so a listing cannot forget it.
- A cascade from project to node that is exactly reversible, so restoring a project is not a guess about which nodes it took with it.
- Context layering computed at read time, so editing a project's instructions is one write rather than a fan-out.

**Non-Goals**

- Nesting projects. The layering rule below is written for a fixed three-level chain (account → project → node) and generalizes if that changes, but nothing here builds the tree.
- Project-level skill or MCP defaults. They belong with Phases 5 and 6, where those settings exist at all.
- Sharing, exporting, or synchronizing a project as a unit.
- Semantic conflict detection between instructions at different scopes. "Nearest wins" is realized by ordering and labelling, not by understanding the prose. See the layering decision.
- Any authorization model beyond the account partition `account-identity` already established. A project is not a permission boundary.

## Decisions

### Membership is one column on the node, not a join table

`WorkspaceNodeRecord` gains `project_id`, non-null, foreign key to a new `projects` table that itself carries `workspace_id`. Membership is read with no join and written with one update.

*Alternative considered — a `project_nodes` join table* allowing a node to belong to several projects. It is the shape most grouping features take, and it superficially serves the same shared-child case: put the shared node in both projects.

Rejected because it makes the layering rule undefined. If a node belongs to two projects with conflicting instructions, "nearest scope wins" has two nearest scopes and no tiebreak that is not arbitrary. Every answer to that — precedence order, most-recently-added, merge both — is a rule the learner has to learn and the system has to explain in the context inspector. The crossing link below already delivers what multi-membership was wanted for, without that cost: the node is in one project and reachable from any number of others.

### A link may cross projects, and nothing enforces containment

No check exists anywhere that compares the two ends' `project_id`. `NodeLinkRecord` is unchanged by this design apart from participating in the crossing scenarios.

*Alternative considered — strict containment with a second edge kind*: parent-child links confined to a project, plus a weaker "reference" edge permitted to cross. It preserves the intuition that a project is a closed unit and gives cross-project relationships somewhere to live.

Rejected because the mission's shared child is a genuine parent-child, not a reference: a correction propagating from either parent must reach it (Phase 9), and it must be reachable by ordinary navigation from both. Downgrading one of the two parent edges to a reference would mean correction propagation, the outline tree, and the canvas each need to know which kind of edge they are looking at, and each would have to answer why one parent's correction reaches the child and the other's does not. Two edge kinds is a permanent tax on every graph traversal in the product to preserve an intuition the mission explicitly rejects.

The honest cost of crossing: "everything in this project" is a membership query, never a reachability query. Every feature that says "in this project" must mean membership. The layering rule below is the first place that matters, and it says so.

### The absent project is a real row, not a null

Creating a workspace creates its default project in the same transaction. `project_id` is non-null from the moment the backfill migration completes.

*Alternative considered — a nullable `project_id`* where null means unassigned. It needs no default row, no creation ordering, and no backfill beyond the column itself.

Rejected because null is a branch that never goes away. Every listing, every canvas grouping, every context assembly, and every "move node" picker forks on `IS NULL` — and the frontend still has to invent an "Unassigned" pseudo-group to render the nulls, because the learner needs somewhere to see those nodes. That pseudo-group is a project in everything but storage. Making it an actual row costs one creation-time write and buys a single uniform code path everywhere else, permanently.

The default project is protected: refusing to delete or archive it is what guarantees a node always has somewhere to be. That refusal is stated in the spec, not left to the UI hiding the control.

### The project a request operates on is named by the client and confirmed, unlike the workspace

The workspace scope stays derived from the active account and never appears in a request. A project identifier does appear in requests, and the same dependency that resolves the scope confirms the named project belongs to it, refusing with not-found otherwise — identically for a foreign project and a nonexistent one, so the response does not disclose which.

The asymmetry is deliberate and worth naming, because `profile-scoped-data-access` reads as "the client never names its scope". A workspace is the scope: there is exactly one per account and nothing to choose, so accepting it from the client is pure attack surface. A project is a choice *within* the scope, and the learner makes several such choices per session.

*Alternative considered — an ambient "active project" resolved server-side*, the way the active profile is. Rejected: a learner works across projects continuously — moving a node, branching into another project, reading a shared child. An ambient current project would make the same request mean different things at different moments and would need its own switch-and-invalidate protocol on the frontend, all to avoid a confirmation check that costs one indexed lookup.

The rule that keeps this safe is that the check lives with the scope resolution, not in each route: a project reference is resolved through one helper that takes the derived scope, so a route that forgets to confirm cannot compile a project reference at all.

### Archive is `archived_at`, and the project cascade is recorded, not recomputed

Both `projects` and `workspace_nodes` gain a nullable `archived_at`. Nodes additionally gain a nullable `archived_with_project_id`. Archiving a project stamps the project, stamps every member node whose `archived_at` is null, and sets those nodes' `archived_with_project_id` to the project — all in one transaction. Restoring the project clears its stamp and clears exactly the nodes carrying that marker. Nodes archived individually beforehand have a null marker and are untouched.

*Alternative considered — recompute the cascade from timestamps*, restoring every node archived at the same instant as its project. It needs no extra column.

Rejected because it is correct only until two archive operations land in the same clock tick, or a clock moves, or a node is archived individually a millisecond after its project. The marker states the fact directly, and the fact is what the restore contract is about.

*Alternative considered — derive a node's archived state from its project* and write nothing to nodes at all. It makes archiving a project one row update instead of many.

Rejected on the read side, which is where the cost lands: every node listing and every canvas query would join to `projects` to know what to show, and the individually-archived-inside-an-archived-project case becomes unrepresentable — exactly the case the restore contract has to get right. Write amplification on an infrequent action is the cheaper side of that trade.

*Consequence for moving an archived node*: moving a node out of an archived project clears its `archived_with_project_id` and leaves `archived_at` set, so it becomes an individually archived node in its new project — restorable on its own, and not restored by restoring the project it left. Nothing else in the move changes.

### One filter decides what "archived" hides, applied at the repository boundary

Listings, canvas queries, and the recency rail all read through repository functions that take an explicit include-archived flag defaulting to excluded. There is no second place where a caller can assemble a node list.

This mirrors the reasoning that put the scoping check in one dependency: a hiding rule spread across call sites is one that a later listing forgets, and the failure mode — archived material reappearing on the canvas — is silent and looks like a data bug rather than a missing filter.

Search is the deliberate exception, and takes the flag as a real parameter because the spec requires archived material to be findable.

### Archived material stays in the retrieval index; the filter is at query time

`source_chunk_fts` keeps its rows for archived material. Retrieval filters archived results at query time using the same flag.

*Alternative considered — delete archived chunks from the projection and reindex on restore.* Rejected on both ends: archived material must stay searchable, so it must stay indexed; and a restore that required a reindex would make restore slow, fallible, and asymmetric with archive.

### Layering is computed at context-assembly time and never denormalized onto nodes

The assembly step collects instructions from account, project, and node scope and emits them ordered widest-first with an explicit scope label on each; the same step collects sources from all three scopes and de-duplicates by source id.

*Alternative considered — copy a project's instructions onto each node when the node joins the project.* It makes assembly a single-row read.

Rejected because it turns every edit of a project's instructions into a fan-out write across its nodes, makes moving a node a rewrite, and — worst — makes the copied text indistinguishable from instructions the learner wrote on the node itself, so the context inspector could no longer attribute an instruction to its scope and "nearest wins" would have nothing to compare.

*How "nearest wins" is actually realized*: the system does not detect that two prose instructions conflict. It orders them widest-first and labels each with its scope, and the assembled preamble states that a nearer scope governs where scopes disagree. This is precisely the mechanism nested `AGENTS.md` relies on, and the reason the spec phrases the outcome as the nearest instruction being "presented as governing" rather than the wider one being removed: removing it would require knowing that a conflict exists.

Sources take the opposite rule — union rather than override — because a source is material, not a directive. A project has no basis for withdrawing a document the account attached, and a learner who attaches a paper account-wide expects to be able to cite it from anywhere. De-duplication is by source identity so a document attached at two scopes is grounded once.

### Bootstrap returns cross-boundary links with a stub for the archived end

A link whose other end is archived is still returned by bootstrap, accompanied by a minimal descriptor of the archived node — identifier, title, archived state — and nothing else. The canvas needs that to render the "link to archived material" indication and to name the node in the restore offer.

*Alternative considered — omit such links and let the frontend fetch on demand.* Rejected: the indication is part of the first paint of the canvas, so on-demand fetching turns the common render into two round trips, and a link silently missing from the first paint is indistinguishable from a link that does not exist.

The descriptor is deliberately minimal: bodies and conversations of archived nodes are not shipped in bootstrap, so archiving a large project still removes its bulk from the startup payload, which is half the point of archiving it.

## Risks / Trade-offs

- **Crossing links make "what is in this project" ambiguous to a learner**, who may reasonably read a drawn edge as membership. → The canvas groups strictly by membership and draws crossing edges through the group boundary rather than around it, so the picture states the distinction instead of hiding it. The context inspector states which project governs the open node by name.

- **Archiving a large project is a bulk write that must be atomic.** A partial cascade would leave some nodes on a canvas whose project has left it. → The stamp of the project and the stamp of its nodes are one transaction; a test archives a project with many nodes and asserts that a failure mid-way leaves nothing archived. This is the same consistency requirement `local-workspace-persistence` already states for multi-record operations.

- **Deleting a project moves its nodes to the default project rather than deleting them**, which will surprise a learner who expected the work to go with it. → The confirmation names the outcome ("its nodes move to the default project") rather than asking a generic "are you sure". The alternative — cascading the delete — is how a learner destroys a graph with one click, which is exactly the failure `account-profiles` separated sign-out from deletion to avoid.

- **`project_id` is non-nullable only after a backfill runs against real learner data.** A defect there detaches every node. → The migration is split (nullable → backfill → non-nullable) so the backfill can be re-run or corrected without a schema rollback, and `backup_database` has already written a timestamped copy. The backfill is idempotent and asserted so by test.

- **This change and `account-identity` both migrate `models/workspace.py`.** Ordering them wrongly produces a `projects` table with a `workspace_id` foreign key to a table mid-alteration. → `projects` depends on `workspaces` existing with `profile_id`, so this change's migrations are chained after `account-identity`'s, including its non-nullable follow-up. Sequencing is asserted by running the full migration chain against a fixture database in test.

- **A future listing could bypass the archive filter** by querying nodes directly. → The repository functions are the only exported way to list nodes, and the spec states exclusion from default listings as a contract, so a bypassing listing fails a spec-derived test rather than merely differing from convention. This is the same containment argument the scoping dependency rests on.

- **The default project is protected by a refusal, and a learner may find that arbitrary** when every other project can be archived. → The refusal message names the reason (it is where nodes without a project go) rather than reporting a generic error. Renaming it is permitted, which covers most of what a learner actually wants.

## Migration Plan

1. One Alembic migration adds `projects` (`id`, `workspace_id`, `name`, `instructions`, `is_default`, `archived_at`, `created_at`) with a unique index on `(workspace_id, is_default)` restricted to the default row, plus the project-source attachment table. Chained after `account-identity`'s final migration.
2. A second migration adds `workspace_nodes.project_id` as **nullable**, `workspace_nodes.archived_at`, and `workspace_nodes.archived_with_project_id`.
3. A data step creates one default project per existing workspace and sets every node's `project_id` to its workspace's default. Idempotent: a later run finds a default project already present and no null `project_id`, and does nothing.
4. A third migration makes `workspace_nodes.project_id` non-nullable, once step 3 is proven. Splitting steps 3 and 4 means the backfill can be corrected without a schema rollback, and a rollback between them requires no data change.
5. Rollback: restore the timestamped copy `backup_database` wrote before step 1. Between steps 3 and 4 the schema tolerates nulls, so reverting only the data step is also safe.

## Open Questions

- Whether the canvas draws a project group as a background container behind its cards or as a boundary around them. It changes no contract — the spec requires only that cards be visually grouped, that the group be identified by its project, and that a crossing link still be drawn — and is best settled against real graphs while building.
- Whether a project's instructions get their own editing surface or share the account-wide instructions surface with a scope selector. Affects no requirement in `project-context-layering`, which specifies what is applied and how it is attributed, not where it is typed.
