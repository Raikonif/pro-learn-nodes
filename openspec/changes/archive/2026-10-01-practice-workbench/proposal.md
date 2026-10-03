## Why

The right rail is three fixed tabs — Q&A, Code, Quiz — whether or not the node has anything in them. A `/quiz` delivery lands in a tab beside two empty ones; three exercises share one Code tab; and every future use (a diagram, flashcards, a table to fill in) would be a fourth, fifth, sixth tab. The rail should show what this node's work actually is, as it arrives, and grow by adding kinds of work rather than tabs.

## What Changes

- **BREAKING (UI)**: The tab strip is replaced by a **workbench**: one surface listing the node's practice as **blocks**. A block is one unit of work — a delivered quiz, a delivered set of questions, one code exercise, the learner's own questions, the node's scratch code.
- One block is expanded at a time and takes the rail's remaining height; the others are one-line headers with a status summary (e.g. "Quiz · 3 questions · 2/3 correct"). Blocks are listed newest first.
- Blocks appear on demand: a delivery from `/code`, `/qa`, `/quiz` or plain words opens its block expanded and highlighted; the learner opens blocks from an **add** control ("+") that offers both writing the work themselves and asking the agent (which places the matching command in the composer).
- A block can be closed. Closing hides it from the list without deleting anything — practice stays append-only — and closed blocks stay reachable. A new delivery into a closed block reopens it.
- Which blocks are open, closed, and expanded is a view preference of this device, never node data.
- Each practice item records the delivery that brought it, so a delivery's items stay together as one block across restarts. Existing items are backfilled from the delivery records already in the conversation.
- The minimap collapses to its breadcrumb while a block is expanded, giving the work the rail's height; hovering restores it, as today.
- Block kinds are registered rather than hard-coded, so a future kind is added by registering it. Only the three existing tools are migrated in this change; no new kinds are introduced.

## Capabilities

### New Capabilities
- `practice-workbench`: the rail's block surface — what a block is, how blocks appear, expand, collapse, close and reopen, the add control, and the arrangement as a device-local view preference.

### Modified Capabilities
- `practice-rail`: the three-peer-tools and selected-tool requirements are removed in favour of the workbench; the empty-state and unavailable-tool requirements are restated for blocks.
- `practice-delivery`: delivered practice opens and highlights its block rather than switching a tab; following a delivery record from the conversation opens that block.
- `practice-items`: an item records the delivery that created it.
- `node-workspace-layout`: the minimap sits above the workbench and collapses to its breadcrumb while a block is expanded.

## Impact

- **Frontend**: `features/practice` — `PracticeRail.tsx` becomes the workbench surface; `QuestionsTool`, `QuizTool`, `CodeTool` become block bodies scoped to a block's items; `practice-store.ts` trades `selectedTool` for the arrangement; `revealPractice` targets a block. The composer gains a way for the add control to place a command (`node-chat` public surface). `app/Workspace.tsx` minimap collapse.
- **Backend**: `practice_items.delivery_id` (nullable) with a migration that backfills from `practice_delivered` messages; `service/agent/sessions.py` stamps items when it records a delivery; the practice API returns `deliveryId`.
- **Tests**: practice component tests rewritten around blocks; E2E specs `practice`, `agent-context`, `panes` updated for the workbench.
- No new dependencies. No change to the MCP tools, the sandbox runtime, or attempts.
