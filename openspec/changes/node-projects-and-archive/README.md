# node-projects-and-archive

Group a graph into projects without severing links, and retire nodes and projects by archiving rather than deleting.

**Partly delivered elsewhere.** Node-level archive — `workspace_nodes.archived_at`, archive/restore of a single node, and the one bootstrap filter that hides archived nodes and their links — landed in `local-sessions-and-history` (migration `20261001_01`), using this change's column and semantics. Tasks 1.6 (the `archived_at` column only), 6.1–6.3, and 7.1 are now verifications. Projects, `archived_with_project_id`, and the project cascade remain this change's.
