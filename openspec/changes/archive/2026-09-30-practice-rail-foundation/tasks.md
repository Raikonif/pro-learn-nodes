Tasks follow `tdd-workflow-conventions`: the failing test precedes the code that satisfies it, and each group ends green. Backend work stays inside `api → service → repository → models`; frontend work stays inside `features/practice/` and exports only through its existing `index.ts`.

## 1. Practice records and schema

- [x] 1.1 Write failing repository tests: create a free-response item and read it back by node; create a multiple-choice item with its options and designated correct option and read it back; items created on one node are absent from another node's query
- [x] 1.2 Add `models/practice.py` with the practice item, practice attempt, and sandbox-buffer models, each carrying its `node_id` and `workspace_id`, the attempt carrying a nullable score, and the sandbox buffer unique per node
- [x] 1.3 Write failing repository tests for attempts: recording an attempt returns it with its timestamp; a second attempt on the same item leaves the first byte-for-byte unchanged; attempts are returned newest first for a node
- [x] 1.4 Write failing repository tests for the sandbox buffer: reading a node with no buffer yields empty rather than an error; writing twice replaces the contents and creates no second row
- [x] 1.5 Add `repository/practice_repo.py` covering item create and list-by-node, attempt insert and list-by-node, and sandbox buffer read and upsert
- [x] 1.6 Generate the Alembic migration adding the three tables, and write a failing test asserting an existing populated database migrates with every existing row preserved

## 2. Practice service — authoring rules

- [x] 2.1 Write failing service tests for free-response authoring: a non-empty prompt creates an item; an empty or whitespace-only prompt is refused with the reason and creates nothing; a reference answer is optional
- [x] 2.2 Write failing service tests for multiple-choice authoring: a prompt with two or more options and exactly one designated correct option creates an item; fewer than two options, no designated correct option, and more than one designated correct option are each refused with the reason and create nothing
- [x] 2.3 Write a failing service test that authoring against a node outside the caller's scope is refused as not found
- [x] 2.4 Implement item authoring in `service/practice_service.py`

## 3. Practice service — attempts

- [x] 3.1 Write a failing service test that a free-response submission records the item, the node, the submitted text, and the time, with no score set
- [x] 3.2 Write a failing service test that a multiple-choice submission records the chosen option and whether it matched the designated correct option
- [x] 3.3 Write a failing service test that answering an already-answered item inserts an additional attempt, modifies no earlier attempt, and that no path exists to edit a stored attempt
- [x] 3.4 Write a failing service test that a node's practice material comes back as its items, their attempts, and its sandbox buffer in one read, containing nothing belonging to another node
- [x] 3.5 Implement attempt recording and the node practice read

## 4. Practice service — sandbox buffer and branching

- [x] 4.1 Write a failing service test that writing a node's sandbox buffer replaces it, and that reading a node that has never had code returns an empty buffer
- [x] 4.2 Write a failing service test that branching a node produces a child with no items, no attempts, and an empty sandbox, and leaves the source node's items, attempts, and buffer unchanged
- [x] 4.3 Write a failing service test that authoring an item and recording an attempt create no node, no node link, and no conversation thread
- [x] 4.4 Implement sandbox buffer persistence and confirm branching needs no practice-copying code path

## 5. Practice routes

- [x] 5.1 Write failing route tests for `GET /practice/nodes/{nodeId}` returning items, attempts, and the sandbox buffer for that node, and refusing a node outside the caller's scope as not found
- [x] 5.2 Write failing route tests for `POST /practice/nodes/{nodeId}/items` covering both kinds and every refusal case from group 2
- [x] 5.3 Write failing route tests for `POST /practice/items/{itemId}/attempts` asserting the response carries the stored attempt and that a repeat submission yields a second attempt rather than an updated one
- [x] 5.4 Write failing route tests for `PUT /practice/nodes/{nodeId}/sandbox` asserting it is idempotent and that the request body carries code only
- [x] 5.5 Add `api/routes/practice.py` with request and response schemas, taking the workspace scope from the request scope dependency and never from the client, and mount it in `main.py`

## 6. Frontend practice data access

- [x] 6.1 Write failing tests for a practice API client in `features/practice/`: it reads a node's practice material, authors items, submits attempts, and surfaces a load failure as a distinguishable failed state rather than empty material
- [x] 6.2 Implement the client against the routes from group 5
- [x] 6.3 Write failing tests for the practice store: material is keyed by node, opening a second node does not show the first node's material, and a submitted attempt appears without refetching the whole node
- [x] 6.4 Implement the store

## 7. Tool surface in the rail

- [x] 7.1 Write a failing test that the practice region offers exactly three tools with one selected, and that selecting another renders its content
- [x] 7.2 Write a failing test that selecting a tool leaves the minimap, the center region, and the left rail unchanged
- [x] 7.3 Write a failing test that the selected tool persists across opening a different node while the content becomes the new node's, and that no record of the selection appears in persisted node data
- [x] 7.4 Write a failing test that with no node open the right rail renders no practice tools and no practice content, and that closing an open node removes them
- [x] 7.5 Write failing tests for the per-tool empty states: the questions tool and the quiz tool each state that the node has no material and offer authoring, while the sandbox presents an editable buffer instead of an empty state
- [x] 7.6 Write failing tests for the unavailable states: a tool that cannot work names what is unavailable, presents no inert controls, leaves the other tools and the minimap working, and offers a retry that restores it
- [x] 7.7 Replace the placeholder panels in `PracticeRail.tsx` with the real tool surface satisfying 7.1 through 7.6

## 8. Code sandbox — the runner

- [x] 8.1 Write a failing test that the runner reports a program's standard output and standard error in the order produced, and reports a program with no output as completed rather than failed
- [x] 8.2 Write a failing test that an uncaught error is reported with its type, message, and line, retaining output produced before it, and that unparseable code is reported the same way with nothing executed
- [x] 8.3 Write a failing test that a run started while another is in progress neither starts, queues, nor interleaves a second run
- [x] 8.4 Write a failing test that stopping a non-terminating run ends it, reports it as stopped by the learner, shows the output produced before the stop, and leaves the sandbox immediately runnable
- [x] 8.5 Write a failing test that a run exceeding the maximum duration is terminated without learner action, reported as timed out with the limit named, and that the sandbox runs normally afterwards
- [x] 8.6 Write a failing test that a run cannot observe names, imports, or side effects from any previous run, including a stopped one
- [x] 8.7 Implement the runner: the interpreter in a dedicated worker, stop and timeout implemented by terminating it, and a replacement worker started afterwards
- [x] 8.8 Vendor the interpreter assets into the app and load them from the bundle, and write a failing test asserting a run performs no request to any host outside the application

## 9. Code sandbox — the tool

- [x] 9.1 Write a failing test that the sandbox renders an editable buffer, a run control, and a result region, and that a run's result appears in it
- [x] 9.2 Write a failing test that the conversation, minimap, left rail, and other practice tools stay interactive while a run is in progress
- [x] 9.3 Write a failing test that the runtime's preparing state is distinct from its unavailable state, and that a failed preparation renders the unavailable state from 7.6
- [x] 9.4 Write a failing test that editing the buffer persists it without an explicit save, that reopening the node restores it, and that the buffer is flushed when the node is closed or another node is opened
- [x] 9.5 Write a failing test that reopening a node shows the persisted code with no output, error, or status from an earlier run
- [x] 9.6 Write a failing test that two nodes hold independent buffers and that a node never visited shows an empty one
- [x] 9.7 Write a failing test that an oversized run result is truncated with the truncation stated rather than rendered whole
- [x] 9.8 Implement the sandbox tool against 9.1 through 9.7

## 10. Question and quiz tools

- [x] 10.1 Write failing tests for authoring a free-response item from the questions tool: it appears without reopening the node, and an empty prompt is refused in place with the reason
- [x] 10.2 Write failing tests for authoring a multiple-choice item from the quiz tool, covering each refusal case from group 2 surfaced in place
- [x] 10.3 Write a failing test that submitting a free-response answer shows the recorded answer, reveals a reference answer only when the item carries one and only after submitting, and shows no score or pass-or-fail judgement
- [x] 10.4 Write a failing test that submitting a multiple-choice answer shows whether the chosen option matched and which option was designated correct
- [x] 10.5 Write a failing test that answering again presents the newest attempt, shows how many attempts exist, and leaves the earlier attempt unchanged
- [x] 10.6 Implement the questions tool and the quiz tool
- [x] 10.7 Confirm `features/practice/index.ts` still exports only the rail's public surface and that no other feature imports an internal practice path

## 11. End-to-end

- [x] 11.1 Add an E2E test: open a node, run a program that prints, see its output; run a program that loops forever, confirm the conversation still responds, stop it, see it reported as stopped
- [x] 11.2 Add an E2E test: author a question, answer it, restart the app, reopen the node, and see the item and its attempt; answer again and see two attempts with the first intact
- [x] 11.3 Add an E2E test: write sandbox code, branch a new node from the source node, and confirm the child's practice region is empty while the source node's code, items, and attempts are unchanged

## 12. Documentation

- [x] 12.1 Record in `CLAUDE.md` that practice code executes in the frontend's WASM sandbox and never in the backend process, and that the interpreter is vendored rather than fetched *(written to `AGENTS.md`: `CLAUDE.md` is deleted in this repo and `AGENTS.md` carries its content)*
- [x] 12.2 Note in `CLAUDE.md` that practice attempts are append-only and that Phase 12 adds generation as a second producer of the same item records *(written to `AGENTS.md`: `CLAUDE.md` is deleted in this repo and `AGENTS.md` carries its content)*
