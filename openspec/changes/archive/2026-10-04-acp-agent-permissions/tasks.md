## 1. Backend: wire and data

- [x] 1.1 `acp/wire.py`: `RequestPermissionParams` parses the agent's `options` (`optionId`, `name`, `kind`) and the tool call's `locations`; answer builders for a selected option; unknown option kinds tolerated; tests
- [x] 1.2 `models/permission.py` (`PermissionDecisionRecord`: account, node, agent, tool kind, allow/refuse, created at) and migration `20261007_01` (table, unique key on account + node + agent + kind); migration test pinned to its revision, including downgrade
- [x] 1.3 `repository/permission_repo.py`: find by key, remember (upsert), list for an account, revoke; every query scoped by account

## 2. Backend: policy and registry

- [x] 2.1 `service/agent/permissions.py` policy: auto-grant only `kind == read` with every location resolving (symlinks followed) inside the node directory; no locations → ask; a remembered decision for the same account, node, agent and kind answers without asking; no `kind` never matches; tests including a symlink escaping the directory and a `..` path
- [x] 2.2 Choosing the reply: the agent's once option of the decided polarity; where none exists, the "always" option, flagged so the prompt can say the agent will remember; tests
- [x] 2.3 Pending-request registry: register a request against its turn, decide exactly once (a second decision is refused), clear every request of a turn when it ends or is cancelled, list pending requests for an account; tests for the race between two surfaces answering
- [x] 2.4 `acp/agent.py`: `session/request_permission` inside a turn goes through the policy, then the registry, and awaits the decision instead of refusing; outside any turn it is still refused and logged; the turn's event queue receives `PermissionRequested` / `PermissionDecided`
- [x] 2.5 `TurnService`: emits `permission.requested` (id, title, kind, locations, whether the agent will remember) and `permission.decided` on the stream; records the learner's allow or refusal in the conversation; an automatic decision is not recorded; turn end or cancel clears its pending requests
- [x] 2.6 Routes per the existing wire style: `POST` decide a request (allow / refuse, optional remember), `GET` pending requests for the active account, `GET` remembered decisions, `DELETE` revoke one; foreign or missing ids refused identically; route tests including cross-account refusal
- [x] 2.7 Fake agent: request permission with a configurable kind and locations, and with options lacking a once kind; `test_agent_sessions` cases for allow lets the agent act, refuse continues, read inside auto-granted, write inside asked, execute asked, remembered decision answers without asking, not across agents, withdrawn when the turn ends

## 3. Backend: node directory lifetime

- [x] 3.1 `profile_service.delete_profile` removes the directory of every node the account owned, after the rows are gone, without following links out of it; remembered decisions are removed with the account; tests including a symlink pointing outside, which must survive
- [x] 3.2 Archiving and restoring a node leave its directory untouched; test
- [x] 3.3 Correct the "effectively read-only" docstring in `service/agent/controls.py` and the refusal notes in `contract.py`, `acp/agent.py`, `sessions.py` that point at this change

## 4. Frontend: data

- [x] 4.1 `chat-api` schemas for `permission.requested` / `permission.decided` (tolerant of absent fields); `turn-store` holds pending requests per turn and clears them on decided, turn end, or cancel; tests
- [x] 4.2 Permissions client and store: decide, pending for the account (polled or refreshed on stream events), remembered list, revoke; tests

## 5. Frontend: surfaces

- [x] 5.1 Inline prompt in `node-chat`: the action and its target, Allow / Refuse, "Remember for this node" naming the kind of action, and the note when the agent will remember the choice itself; the recorded decision renders in the conversation beside the existing refusal notice
- [x] 5.2 Workspace-level indicator: count of pending requests from nodes not on screen, listing each with its node, answerable in place and opening the node; clears when answered inline
- [x] 5.3 Settings: remembered decisions listed by node, agent and kind of action, each revocable
- [x] 5.4 Correct the "effectively read-only" note in `features/node-chat/session-controls.ts`
- [x] 5.5 Component tests for 5.1–5.3

## 6. Verification

- [x] 6.1 E2E `permissions.spec.ts` on the fake agent: a write is asked and allowed and the agent acts; refused and the turn continues; remember for this node and the next write is not asked, another node is; revoke and it is asked again; a request from a node off screen appears in the indicator and is answered there; a cancelled turn leaves nothing pending
- [x] 6.2 Full suites green; rebuild sidecar and bundle; in the built app, on a real agent in a mode that asks, let it write a file in a node's directory, remember it, revoke it
