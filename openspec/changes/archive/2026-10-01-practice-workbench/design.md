## Context

`PracticeRail.tsx` renders a tab strip over `QuestionsTool`, `CodeTool` and `QuizTool`; `practice-store.ts` holds `selectedTool` and maps a delivery's tool (`code`/`qa`/`quiz`) to a tab. Each tool renders every item of its kind on the node, so two quiz deliveries merge into one list and three exercises share the Code tab (the exercise picker is inside `CodeTool`).

A delivery is already a durable thing: `TurnService` records one `practice_delivered` message per (turn, tool), with `data = {"tool", "itemIds"}`, and the stream event `practice.delivered` carries that message's id. Items, however, do not know which delivery brought them, so after a reload the frontend cannot group them without reading the conversation.

`node-chat` imports `revealPractice` and `practiceToolLabel` from `practice`, so `practice` cannot import from `node-chat` without a cycle.

## Goals / Non-Goals

**Goals:**
- One rail surface whose content is the node's actual work, grouped the way it arrived.
- A block kind is a registration, so a later kind (diagram, flashcards, note) touches no existing kind and not the surface.
- Same data, same attempts, same sandbox: this is a presentation change plus one column.

**Non-Goals:**
- New block kinds, agent-authored free-form blocks, or HTML/JS rendered from agent output.
- Reordering blocks by hand, pinning, or side-by-side blocks.
- Any change to the MCP tools, attempts, the sandbox worker, or what is mirrored to the node directory.

## Decisions

### A block is derived from material, not stored
Blocks are computed by a pure function `blocksOf(items, attempts, scratch)` in the practice store:

| Block key | Holds |
|---|---|
| `delivery:<deliveryId>` | multiple-choice or free-response items sharing a delivery |
| `exercise:<itemId>` | one code exercise (exercises are never grouped: each has its own buffer and is worked alone) |
| `mine:quiz`, `mine:qa` | learner-authored items of that kind |
| `scratch` | the node's free buffer |

Agent items with no delivery (should not exist after the backfill, but data is data) fall into `agent:<kind>:<agentId>`. The order is newest first, by the newest item in the block; `scratch` is ordered by its buffer's `updatedAt`.

*Alternative:* persist blocks as rows. Rejected: a block has no content of its own, only membership, and a second record of membership would drift from the items.

### Items record their delivery (`practice_items.delivery_id`)
A nullable column holding the id of the `practice_delivered` message. `TurnService._record_delivery` already creates or updates that message with the accumulated `itemIds`; it now also stamps those items in the same transaction, through `practice_service`. A migration backfills the column from existing `practice_delivered` messages (`json_each(data, '$.itemIds')`). The practice API returns `deliveryId`.

*Alternative:* group on the frontend by reading the conversation's delivery records. Rejected: practice would depend on the conversation being loaded, and threads other than the open one hold deliveries too.

The column is a plain string, not a foreign key: messages are never deleted, and an FK into `chat_messages` would only add a cascade question with no answer.

### The block-kind registry
```ts
type BlockKind = {
  id: 'quiz' | 'qa' | 'code' | 'scratch'  // widened when a kind is added
  label: string
  summarize(block: Block, material): string     // the header's status line
  Body: ComponentType<{ nodeId: string; block: Block }>
  add?: { write: (nodeId) => BlockKey; ask?: '/code' | '/qa' | '/quiz' }
}
```
The registry lives in `features/practice/workbench/kinds.ts`; the surface (`Workbench.tsx`) only iterates blocks and looks kinds up. The existing tools become bodies scoped to a block: `QuizTool` and `QuestionsTool` take the block's `itemIds` instead of filtering the whole node; `CodeTool` loses its internal exercise picker, because each exercise is now its own block, and is given either the exercise or the scratch buffer.

*Alternative:* a generic plugin system across features. Rejected for now: every kind today is practice, and the registry's shape can move to `shared/` the day a non-practice kind arrives.

### The arrangement is per node, in `localStorage`
`{ [nodeId]: { expanded: BlockKey | null, closed: BlockKey[] } }` under one key, read once and written debounced, wrapped in try/catch like `pane-layout.ts`. `selectedTool` is deleted. With no stored arrangement, the newest block is expanded. `reveal()` now takes a `BlockKey`: it removes the key from `closed`, sets `expanded`, re-reads material, and sets the highlight as before.

The delivery-to-block mapping lives in practice's public surface (`blockForDelivery({tool, messageId, itemIds})` → `exercise:<first itemId>` for code, `delivery:<messageId>` otherwise), so `node-chat` keeps calling one function and never learns block keys.

### Asking the agent goes through `Workspace`, not an import
The add control's "Ask the agent" calls an `onAskAgent(command)` prop. `Workspace.tsx` wires it to a new `node-chat` export, `placeInComposer(text)`, which sets the composer's draft and focuses it. This keeps the dependency one-way (`node-chat → practice`) and keeps `app/` as the only place both are composed.

### Minimap collapse follows the expanded block
The practice public surface exports `useHasExpandedBlock(nodeId)`. `Workspace` passes `collapsed={hasExpanded || heightTooSmall}` to `GraphRail`, which already renders the breadcrumb with hover-to-expand. No change to `GraphRail` beyond accepting the flag.

### Accessibility
Headers are disclosure buttons (`aria-expanded`, `aria-controls`) in a list; the close control is a separate labelled button so it is never activated by expanding. The add control is a menu button. Collapsing is a CSS `hidden` on the body, so editors keep their state, which is also what preserves unsaved code.

## Risks / Trade-offs

- [A node with many deliveries becomes a long list of headers] → newest first, and closing exists; headers are one line. Grouping by day is a later option.
- [A collapsed `CodeTool` body that stays mounted keeps a CodeMirror instance per exercise] → only the expanded block's body is mounted; buffers already live in the store, not the component, so unmounting loses nothing.
- [Backfill misses items whose delivery message was never recorded (a turn that crashed mid-delivery)] → they land in `agent:<kind>:<agentId>`, still visible and answerable.
- [E2E specs select tabs by role `tab`] → rewritten against block headers in the same change.

## Migration Plan

One Alembic revision: add `practice_items.delivery_id` (nullable, indexed) and backfill it from `chat_messages` where `kind = 'practice_delivered'`. Downgrade drops the column. The frontend tolerates `deliveryId` being absent (zod default `null`), so an older backend still renders, with agent items grouped by author.
