## Context

See `proposal.md - Why` for motivation. The relevant current state:

- `frontend/src/features/practice/components/PracticeRail.tsx` is a tab shell with three placeholder panels, mounted by `app/Workspace.tsx` inside `data-testid="right-rail-tools"` and rendered only while a node is open. `GraphRail` sits above it in a fixed-height region and already receives the rail's measured height so it can collapse to a breadcrumb.
- `node-workspace-layout` fixes the arrangement this change fills in: the minimap is not a peer tab of the practice tools, and selecting a tool must not hide it. That is a constraint, not a decision left open here.
- The backend has `models/workspace.py`, `service/workspace.py`, and `service/retrieval.py`, all scoped by `workspace_id`, with `api → service → repository → models` enforced by `backend-layered-architecture`. There is no practice model, repository, service, or route.
- There is no AI provider layer, no `Provider` protocol, and no adapter. Nothing in this change may depend on one existing.
- `local-workspace-persistence` already states that the frontend SHALL NOT be the authoritative durable store for workspace data.

Constraints: the app must work offline; the frontend runs inside the macOS system WebView under Tauri, not a browser the learner chose; the workspace must stay usable at 800×600, which is what makes the rail's height budget scarce.

## Goals / Non-Goals

**Goals**

- A practice surface whose contracts Phase 12 extends rather than replaces — generation becomes an additional *producer* of practice items, not a parallel system.
- Code execution that a runaway program cannot take the workspace down with, as a property of where execution happens rather than of the learner's code being well behaved.
- Practice state that is durable, node-scoped, and inspectable in the same SQLite file as everything else.

**Non-Goals**

- Any evaluation of free text. An ungraded attempt record is the deliberate output of this change, not a gap in it.
- A general-purpose code editor. The sandbox is a buffer, a run control, and a result region; language services, multi-file projects, package installation, and file system access are out.
- Carrying interpreter state across runs. See *Every run starts from a clean interpreter* in the spec — it follows from how a run is terminated, and pretending otherwise would make the stop control a lie.
- Making practice reachable from anywhere but the open node's rail. There is no practice route, no practice view, and no cross-node practice index in this change.

## Decisions

### Practice stays in the rail, and the reason is that practice is an activity rather than a document

OpenAI removed ChatGPT's Canvas side panel from its current models and replaced it with editable writing and code blocks rendered inline in the conversation. That is a very large-scale retreat from exactly the pattern this rail resembles, and it deserves an answer rather than a dismissal.

The answer is that Canvas and this rail hold different kinds of thing. Canvas held the document the conversation was *about*: its content was the conversation's output, every turn revised it, and the split forced the reader to look in two places at one artifact. Collapsing it inline removes a seam that never carried meaning. The practice rail holds a *different activity* from the conversation — a code buffer the learner returns to across sessions, and questions whose answers accumulate a history. Its state is node-scoped and outlives any turn, so there is no single message it belongs beside.

Two further reasons are local rather than general. The rail exists regardless: `node-workspace-layout` already puts the minimap in it, so practice occupies space that would otherwise be empty rather than claiming space from the conversation. And inline practice would contradict a requirement already accepted — the practice tools are specified to live below the minimap — so moving them inline is a spec change, not a free implementation choice.

*Alternative considered — render practice inline in the conversation as blocks*, matching where OpenAI landed. Rejected for this change on the three grounds above, and on one more: with no provider layer, nothing generates practice mid-conversation, so there is no message for an inline block to attach to. Inline practice is a shape that only becomes natural once the agent authors the material in the flow of a turn.

What would have to be true to move it: if, after Phase 12, most practice items are generated inside a conversation turn, answered within that same turn, and never revisited, then the rail is a second place to look at content that belongs in the transcript, and questions should render inline. The falsifiable signal is the attempt log this change creates — items whose attempts cluster in a single sitting and never recur are inline material; items answered repeatedly across days are not. The code sandbox is the part least likely to move either way, because a buffer that persists per node is not a message.

### Execution happens off the main thread, and termination is the stop mechanism

The Python runtime runs in a dedicated worker. The stop control and the timeout both terminate that worker outright; a fresh one is started immediately afterwards so the next run does not pay the cold start.

*Alternative considered — run on the main thread and interrupt with the runtime's interrupt buffer.* It preserves interpreter state across runs and avoids worker message plumbing. Rejected on two counts. The interrupt buffer requires a `SharedArrayBuffer`, which requires cross-origin isolation, which means COOP/COEP headers on both the Vite dev server and the Tauri asset protocol — a platform-wide constraint acquired for one feature. And even with it, an interrupt is delivered at a Python bytecode boundary: a loop inside a native extension never yields, so the guarantee has holes exactly where a hung run is most likely. Terminating a worker has no holes.

The consequence is stated in the spec rather than hidden: terminating discards the interpreter, so no run can observe a previous run's state, and the whole buffer is always the program.

### Execution is in the WebView's WASM sandbox, not in the FastAPI sidecar

The sidecar is a Python process. Running the learner's code there would be less work than shipping an interpreter to the frontend, and it is the wrong trade by a wide margin: that process holds the database connection and the learner's whole graph, and `exec` inside it is arbitrary code execution against their own data with no boundary at all. Making it safe means an OS-level sandbox — a separate process, a seccomp or sandbox profile, resource limits — which is a larger project than the feature.

*Alternative considered — execute in the sidecar with a subprocess and resource limits.* Rejected: it turns a browser-sandboxed feature into a security-critical one, and macOS process sandboxing is where the effort would go instead of into practice. The WASM sandbox gives isolation, a hard memory ceiling, and no file system or network by default, for free.

### The runtime is vendored and lazy-loaded, never fetched from a network

The interpreter's assets ship inside the application bundle and are served from it, and they are loaded the first time the sandbox tool is selected rather than at app start.

*Alternative considered — load the runtime from a public CDN*, which is how it is normally distributed and keeps the bundle small. Rejected outright: it breaks the sandbox with no network, which contradicts the local-first mission and the spec's offline requirement, and it sends a request on the learner's behalf to a third party the app never told them about.

Lazy loading is what keeps the cost honest — an app start that never opens the sandbox pays nothing, and the tool's "preparing" and "unavailable" states in `practice-rail` exist precisely because the load is deferred and can fail.

### Persistence goes through the backend, in the existing SQLite file

Three tables: a practice item (node, kind, prompt, options, designated correct option, optional reference answer), an attempt (item, node, response text or chosen option, correctness where computable, timestamp), and a sandbox buffer keyed one-per-node. Routes follow `api → service → repository → models` with no shortcut.

*Alternative considered — keep sandbox code and attempts in browser storage.* It is faster to build, needs no migration, and the material is genuinely local to one device anyway. Rejected because `local-workspace-persistence` already settled this: the frontend is not the authoritative store. Practice that vanishes when the WebView's storage is cleared, and that is invisible to the SQLite file the mission promises is inspectable and copyable, is not "yours forever".

The sandbox buffer is written on a debounce rather than on a save control, because the spec requires persistence without an explicit save. The debounce is the reason the spec says the buffer survives leaving the node, not that every keystroke is durable.

### Attempts are append-only rows, not a mutable answer on the item

Answering again inserts; nothing updates. The item carries no "current answer" field at all — the latest attempt is the newest row.

*Alternative considered — one answer per item, overwritten on resubmission.* Simpler to query and simpler to render. Rejected because it destroys the thing practice is for. A learner who answered wrong, learned, and answered right has produced the single most informative record in the system, and an overwrite deletes it. It also forecloses Phase 12's grading, which needs to score an attempt at a point in time rather than a field that moves under it.

This is also the answer to changing an answer after submitting: it is allowed, unrestricted, and it is recorded as a new attempt rather than a correction of the old one.

### A branch inherits no practice material

A child node created by branching starts with nothing: no items, no attempts, no sandbox code.

*Alternatives considered — copy the parent's items into the child*, or *link the child to the parent's items so both surfaces show them*. Copying was rejected because an item and its attempts travel together in the learner's mind; copying items without attempts produces questions that look answered nowhere, and copying attempts fabricates a history in a node the learner has never worked in. Linking was rejected because the DAG allows a node under multiple parents, so a linked item would have to resolve through several ancestors with no rule for which wins, and answering a shared item would make an attempt whose node is ambiguous — precisely the ambiguity `Correction` propagation is careful to make explicit and consensual.

Nothing is lost: the parent's material stays on the parent, one hop away in the minimap. If inheritance turns out to be wanted, it is addable as an explicit choice in the branch configuration modal Phase 8 already specifies, alongside the skill and MCP inheritance toggles — which is where a decision like this belongs, rather than as an implicit default.

### Attempts link to a node; they do not become nodes

Phase 12 states that practice attempts are children of the node they came from. This change deliberately does not do that. An attempt row carries `node_id` and stops there.

*Alternative considered — model attempts as nodes now*, which would be forward-compatible with Phase 12 and give attempts graph visibility for free. Rejected because every accepted spec treats a node as a session: it has exactly one unanchored main thread (`node-chat-threads`), it appears in the left rail, the canvas, and the minimap, and it is enterable. An attempt satisfies none of that, so admitting it to the graph means either weakening those requirements or shipping nodes that break them. The spec states the exclusion as a contract so a later change has to argue for the promotion rather than drift into it.

Migration path if Phase 12 keeps that plan: the attempt row already names its node, so promotion is adding a node reference and a backfill, not a re-model.

### Manual authoring is the first producer of the item contract, not a stub around it

The item shape — prompt, options, designated correct option, optional reference answer — is designed to be what a generator emits, not a lesser form of it. Phase 12 adds a second producer that writes the same rows; the tools, the attempt path, and the storage do not change. A rubric, when it exists, attaches to the item and is consumed by a grader that sets a score on an attempt, which is why an attempt already has a nullable score rather than no score concept at all.

This is the same shape as `account-identity`'s development sign-in: the thing available now implements the real contract, so the thing that needs an external dependency arrives as one more implementation with a passing suite to conform to.

### The tools are tabs within the lower region

Three peer tabs, as the current shell already renders.

*Alternative considered — a stacked accordion showing all three sections at once.* Rejected on the height budget: at 800×600 the rail's lower region must hold a code editor and a result pane at a usable size, and the minimap above it is what collapses first under pressure. Three simultaneously visible sections would force the minimap into its breadcrumb state permanently, defeating the requirement that put the minimap there.

### The route contract

Fixed here so the frontend and backend can be built independently:

| Route | Behavior |
|---|---|
| `GET /practice/nodes/{nodeId}` | The node's items, their attempts, and its sandbox buffer in one response — the rail needs all three to render any tool, and three round trips per node open is the wrong default. |
| `POST /practice/nodes/{nodeId}/items` | Creates an item. Refuses an empty prompt, or a multiple-choice item without at least two options and exactly one designated correct option, with the reason named. |
| `POST /practice/items/{itemId}/attempts` | Records an attempt. Always inserts; never updates. Returns the stored attempt, including computed correctness for a multiple-choice item. |
| `PUT /practice/nodes/{nodeId}/sandbox` | Replaces the node's sandbox buffer. Idempotent, debounced by the client, and carries only code — a run's output is never sent. |

The workspace scope comes from the request scope dependency, never from the client, following `profile-scoped-data-access`. `nodeId` is a path parameter because it identifies material within an already-determined scope; a node belonging to another profile's workspace is refused as not found, exactly as the workspace routes refuse one.

### The wire shapes

Fixed alongside the routes (2026-10-01), so the backend, the rail, and the sandbox can be built in parallel. JSON is camelCase, as every other route.

- `Item = { id, nodeId, kind: "free_response" | "multiple_choice", prompt, options: { text, correct }[], referenceAnswer: string | null, createdAt }` — `options` is empty for a free-response item. Each option carries its own `correct` flag rather than the item carrying one index: "more than one designated correct option" must be a refusable input, and an index cannot express it.
- `Attempt = { id, itemId, nodeId, response: string | null, chosenOption: number | null, correct: boolean | null, score: number | null, createdAt }` — `response` for free response, `chosenOption` (an index into `options`) for multiple choice; `correct` computed only for multiple choice; `score` always null in this change.
- `GET /practice/nodes/{nodeId}` → `{ nodeId, items: Item[], attempts: Attempt[], sandbox: { code: string, updatedAt: string | null } }` — items oldest first, attempts newest first, `code` empty and `updatedAt` null for a node that never had code.
- `POST /practice/nodes/{nodeId}/items` `{ kind, prompt, options?, referenceAnswer? }` → `Item`; a refusal is `422 { detail: "<the reason, for the learner>" }`.
- `POST /practice/items/{itemId}/attempts` `{ response? }` or `{ chosenOption? }` → `Attempt`; an answer of the wrong shape for the item's kind is a 422 with the reason.
- `PUT /practice/nodes/{nodeId}/sandbox` `{ code }` → `{ code, updatedAt }`.

Any node or item outside the caller's scope is `404`, indistinguishable from one that does not exist.

## Risks / Trade-offs

- **The interpreter is a large asset in an app that advertises a ~10MB bundle.** The runtime core is on the order of ten megabytes before any package. → It is lazy-loaded, so start-up and every session that never opens the sandbox are unaffected; the size lands in the installed bundle, which is stated in the proposal's *Impact* rather than discovered at build time. No scientific package is bundled; if one is ever wanted, it is a separate decision with its own size argument.

- **Terminating the worker to stop a run discards interpreter state, which will surprise a learner who expects a REPL.** → The spec makes it a stated behavior with its own scenarios, and the sandbox is presented as running a program rather than as a session. A REPL with durable state cannot coexist with an unconditional stop, and the stop is the requirement worth keeping.

- **A run can still exhaust memory or spawn work the worker cannot be blamed for.** WASM memory limits abort the run rather than the app, but a very large output can make the result pane expensive to render. → The result pane truncates beyond a fixed size and says it truncated; the run itself is bounded by the time limit regardless.

- **Debounced sandbox persistence can lose the last edit if the app is killed within the debounce window.** → The window is short and the buffer is also flushed when the node is closed or another node is opened, which covers the ordinary exit paths. Guaranteeing every keystroke would mean a write per character against SQLite for a feature where the loss is a few seconds of typing.

- **Manually authored items may be little used before Phase 12 generates them.** The honest risk is building an authoring surface a learner ignores. → It is small, it is the contract Phase 12 writes into, and it is what makes the attempt path testable end to end without a model. The fixtures the suite needs are authored through the same path a learner uses, which is why there is no separate seeding mechanism.

- **This change depends on how the request scope is resolved, which `account-identity` is changing concurrently.** → The practice routes take the scope from the same dependency as every other workspace route and never accept a workspace identifier from the client, so they conform to the new contract whichever order the two changes land in.

## Migration Plan

1. One Alembic migration adds the practice item, attempt, and sandbox-buffer tables. All three are new; no existing table is altered, so there is no backfill and no data at risk.
2. The frontend change is confined to `features/practice/` plus its existing mount point, so a rollback is reverting the feature directory; the rail returns to its placeholder panels and the layout requirements it satisfies are unaffected.
3. Rollback of the migration drops three tables that nothing else references.

## Open Questions

- The exact maximum run duration. Ten seconds is the working value; it can move after the sandbox is usable without changing any spec, which states the limit exists and must be named to the learner rather than what it is.
- Whether the questions tool and the quiz tool should merge into one list of items once both exist. The spec requires three tools because the accepted layout and the current shell have three; merging would be a later, separately argued layout change.
- Whether a learner should be able to delete a practice item they authored. Nothing in the app deletes a node yet either, so item deletion has no established shape to follow and no requirement depends on it.
