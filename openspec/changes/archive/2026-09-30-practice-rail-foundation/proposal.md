## Why

The right rail already reserves its lower region for practice tools — `node-workspace-layout` requires the minimap to sit above them and to stay visible whichever tool is selected — but that region renders three placeholder tabs. The rail's height budget, and the minimap collapse rule that depends on it, are therefore measured against content that does not exist.

Phase 12 fills that region with material the agent self-authors, which needs the AI provider layer (Phase 4) and everything between it and Phase 12. Most of the practice surface does not: running Python in the browser needs no model, and a question a learner writes for themselves needs no model to be answered or recorded. This change ships that part now, so the rail becomes a real working surface and Phase 12 arrives as content generation against an existing contract rather than as a whole subsystem.

## What Changes

- Turn the placeholder practice strip into a real tool surface: three peer tools inside the right rail's lower region — questions, code sandbox, quiz — with one selected at a time, the minimap untouched above them, and a stated behavior for the states the placeholders never had (no material on this node, tool unavailable, no node open at all).
- Add a **code sandbox**: an editable Python buffer per node, run on the learner's own device, showing the program's output and its errors. A program that never terminates SHALL be stoppable and SHALL be terminated on a time limit, and SHALL never freeze the workspace while it runs.
- Persist the sandbox buffer against its node so returning to a node returns to the code; deliberately do not restore a previous run's output alongside it.
- Add **manually authored practice items**: a free-response question and a multiple-choice question, authored by a learner (or seeded by a fixture) on a node, answerable in the rail.
- Record every submission as an **attempt** linked to its node and item. Attempts are append-only: answering again adds a record and never rewrites one, so a node carries a history rather than a last value.
- State that practice material and attempts belong to the node they were made on and are **not inherited when a node is branched**, and that neither items nor attempts appear as nodes in the graph, the minimap, or the left rail.

## Capabilities

### New Capabilities

- `practice-rail`: The practice tool surface in the right rail's lower region — which tools exist, how one is selected, what persists across node switches, and what each tool shows when the node has no material, when the tool cannot run, and when no node is open.
- `code-sandbox`: Writing and running Python inside a node — output, errors, non-termination and cancellation, the run time limit, and what of a sandbox survives leaving the node.
- `practice-items`: Practice questions attached to a node — authoring a free-response or multiple-choice question, answering it, the attempt record each submission produces, and how items and attempts relate to node branching and to the graph.

### Modified Capabilities

- `node-workspace-layout`: with no node open, the right rail renders no practice tools either — the existing requirement fixes only the minimap's absence, which was sufficient while the practice region was a placeholder.

## Impact

- **Frontend**: `features/practice/` grows from a tab shell into the tool surface, the sandbox, and the item tools, all still exported through its single `index.ts`. `app/Workspace.tsx` is unchanged — the rail already mounts `PracticeRail` only while a node is open.
- **Frontend dependency**: a Python-in-WebAssembly runtime is vendored into the app rather than fetched from a network, and loaded only when the sandbox is first opened. This is the first substantial addition to the frontend bundle.
- **Backend**: new `models/practice.py`, `repository/practice_repo.py`, `service/practice_service.py`, `api/routes/practice.py`, following the existing `api → service → repository → models` direction. One Alembic migration adds the practice item, attempt, and sandbox-buffer tables.
- **Deliberately not touched**: no provider, adapter, or model call anywhere in this change; the `Node` model gains no new columns and the graph gains no new kind of member.
- **Deferred to Phase 12**: generation of items and rubrics, grading of free text, mode-driven practice behavior, and promoting attempts into graph nodes. Each is additive to what this change defines.
