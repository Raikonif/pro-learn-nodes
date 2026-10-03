## 1. Resolving the origin

- [x] 1.1 Tests first (`test_branch_inheritance.py`): a branched node's origin is its creating link's anchor message (cut inclusive, nothing after); a whole-node child's cut is its creation time (later parent messages excluded); a side thread's origin is its own anchor; a root node and a main thread with no link have no origin; a node later linked under a second parent keeps its first origin
- [x] 1.2 `service/workspace.py`: `conversation_origin(workspace_id, thread_id) -> Origin | None` (parent title, passage excerpt or None, the bounded transcript, `omitted: bool`) with the 24,000-character budget, newest first, cut message always kept

## 2. Handing it to the agent

- [x] 2.1 Tests first (in-memory `FakeAgent`): a branched child's first prompt carries the origin preamble with the passage and the parent's messages up to the cut and nothing after; the second turn does not; a side thread's first prompt carries its main thread up to the anchor; switching agents inside the child gives the new agent the origin and the child's own transcript; a root node's first prompt has no preamble
- [x] 2.2 `TurnService._session`: when a new agent session is opened, prepend the origin preamble (after the orientation note, before any replay)
- [x] 2.3 Bounded case: a parent longer than the budget yields the newest messages, the cut message, and the omission statement

## 3. Showing the origin

- [x] 3.1 Frontend: derive a node's origin from bootstrap links (first link to it) and a thread's from its anchor; render a line at the top of the conversation ("Branched from *Parent* · “passage”") that opens the parent at the passage via `openSessionAt`; tests
- [x] 3.2 Playwright with the fake agent (`recall` shows what its session received): branch from a passage, write in the child, and the agent's first prompt contains the parent's message and the passage; the origin line returns to the parent passage

## 4. Verification

- [x] 4.1 Full suites green; rebuild sidecar and bundle; in the built app, branch from a passage and ask the agent what the branch is about
