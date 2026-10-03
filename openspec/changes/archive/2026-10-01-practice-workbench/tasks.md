## 1. Items record their delivery

- [x] 1.1 Migration: add nullable, indexed `practice_items.delivery_id`; backfill from `practice_delivered` messages' `data.itemIds`; migration test (before/after, downgrade)
- [x] 1.2 `practice_service`: stamp a delivery's items; `TurnService._record_delivery` stamps them in the same transaction; tests that two turns give two delivery ids and learner items stay null
- [x] 1.3 Practice API returns `deliveryId`; frontend `PracticeItemSchema` parses it (nullable, defaulting to `null`)

## 2. Blocks and arrangement (store)

- [x] 2.1 `blocksOf(items, attempts, scratch)`: block keys, grouping, newest-first ordering, fallback `agent:<kind>:<agentId>`; unit tests including two deliveries of one kind
- [x] 2.2 Status summaries per kind (answered / correct counts, exercise submitted / matched); unit tests
- [x] 2.3 Arrangement per node in `localStorage` (expanded, closed), guarded reads/writes, default to newest block; remove `selectedTool`; tests for restart and the absence from node data
- [x] 2.4 `reveal(blockKey)` reopens, expands and highlights; `blockForDelivery` in the public surface; `node-chat` callers (`turn-store`, `TurnEntries`) switched; delivery labels name the block kind

## 3. Workbench surface

- [x] 3.1 Block-kind registry (`workbench/kinds.ts`) with quiz, qa, code, scratch
- [x] 3.2 `QuizTool` and `QuestionsTool` take a block's `itemIds`; `CodeTool` takes one exercise or the scratch buffer and drops its exercise picker
- [x] 3.3 `Workbench.tsx` replaces the tab strip: headers as disclosure buttons, one expanded body, close control, "closed (n)" reopen list, empty-node state, load-failure state with retry
- [x] 3.4 Add control: write-it-yourself per kind; "Ask the agent" via `onAskAgent` when the node runs on an agent
- [x] 3.5 `node-chat` exports `placeInComposer(text)`; `Workspace` wires `onAskAgent` to it; composer test that nothing is sent
- [x] 3.6 `useHasExpandedBlock`; `Workspace` passes the collapse flag to `GraphRail`; tests for collapse and hover

## 4. Verification

- [x] 4.1 Rewrite practice component tests around blocks; update E2E `practice`, `agent-context`, `panes` and add a workbench spec (two deliveries → two blocks; close and follow the delivery record reopens; arrangement survives reload)
- [x] 4.2 Full suites green; rebuild sidecar and bundle; in the built app, `/quiz` twice and `/code` once on one node, close a block, restart
