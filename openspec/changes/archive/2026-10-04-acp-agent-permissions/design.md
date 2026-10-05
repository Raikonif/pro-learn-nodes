## Context

`acp-agent-backend` connects agents, streams turns, and continues conversations across restarts. It answers every `session/request_permission` with a visible refusal and gives each node a working directory of its own, which practice now fills with the exercise the learner is working on. `agent-session-controls` then offered the agent's permission modes — and a mode that asks before acting cannot act at all while nobody is asked. This change closes that gap, and fixes what the existing node directory may hold and when it is removed. Branching on agent backends, once part of this change, shipped as `node-branch-inheritance`; file attachments are left to a later change. Decisions below were first taken on 2026-09-30 and revised on 2026-10-03.

## Decisions

### The node directory exists; this change fixes its reach and lifetime

`session/new` requires a working directory, and each node already has one: `agent-workspaces/<node_id>` beside the data store, never inside it and never a parent of another node's. It bounds what the agent's own file tools are pointed at to exactly one node's material, and today that material is the practice copy — the exercise and the learner's current solution, written there so the agent can read them.

The auto-read policy below rests on that bound, so it is stated rather than assumed: the directory holds only its node's material, and never the data store or another node's. Archiving a node keeps its directory, because archiving is reversible and a restored node should find its material where it left it. Deleting an account removes the directories of every node it owned — today they outlive the account. Removal never follows a link out of the directory.

### Permissions: read inside the node is automatic, everything else is asked

`session/request_permission` is a **required** client method. An agent will block on it. A request the learner never sees is a conversation that hangs with no explanation — the same class of dead end `first-launch-entry` exists to remove.

The policy: reading within the node's own working directory is granted without asking, because that directory holds only material belonging to this node and prompting for it would train the learner to approve without reading. Writing, acting outside the directory, and executing anything are always asked.

A request counts as a read inside the directory only when its tool call's `kind` is `read` and **every** location it names resolves — symlinks followed — to a path inside the node's directory. A request that names no location is asked: what cannot be shown to be inside is treated as outside.

Remembered decisions are scoped to what the learner chose and never cross agents or accounts. A permission remembered under one account and applied under another would breach the profile partition that `profile-scoped-data-access` establishes.

### A remembered decision is one kind of action, in one node, on one agent

A remembered decision is keyed by account, node, agent, and the tool call's `kind` (`edit`, `execute`, `delete`, `fetch`, …), with the learner's answer. "Always allow edits in this node" reads plainly in the review list and is revoked as one entry. Matching on the agent's title as well was rejected: titles name the file or command of each call, so a remembered decision would rarely match again and the learner would be asked almost as often as before.

The only scope offered is the node. Wider scopes — every node on this agent — are left until prompts at node scope prove tiring; adding one is a new key, not a new mechanism. A request with no `kind` is never matched by a remembered decision.

Switching a node to another agent leaves its remembered decisions in place for the original agent, so switching back finds them; they never apply to the other agent. Archiving a node keeps them; deleting the account removes them.

### The agent's own "always" options are not chosen on the learner's behalf

A request carries the agent's options, each with a kind: `allow_once`, `allow_always`, `reject_once`, `reject_always`. An agent that is answered with an "always" option remembers the choice itself, somewhere the application cannot list or revoke.

The application answers with the agent's *once* option of the learner's polarity and does its remembering itself, so every remembered decision is in the learner's review-and-revoke list. Where an agent offers no once option of that polarity, the prompt says that the agent will remember the choice itself before the learner answers.

### The prompt lives in two places

Inline, next to the turn that caused it, because that is where the learner can judge it. And a workspace-level indicator for requests from nodes that are not on screen, because the spec forbids a request being lost or failed merely for being out of view — and a learner running two nodes on agents at once is the ordinary case, not the edge.

Both are views of one pending-request registry in the backend. A request is decided once; whichever surface answers first wins and the other clears. The SSE stream announces a request; the decision arrives on its own route. That keeps the transport unidirectional, as `acp-agent-backend` chose.

A request arriving outside any turn has no conversation to appear in, and is still refused and logged, as `acp-agent-backend` does today.

### A decision is recorded in the conversation

An allow or a refusal the learner gives is recorded in the conversation beside the turn, as the automatic refusal is recorded today, so the record shows what the agent asked and what the learner answered. An automatic read is not recorded: it is the policy working, and recording each one would bury the decisions that were made.

## Risks / Trade-offs

- **Prompt fatigue.** Asking for every write trains approval without reading. Remembering a kind of action for a node is the mitigation; a wider scope is a later change if node scope proves tiring.
- **Deleting an account deletes files.** The node directories hold the learner's practice; a removal that follows a symlink out of one would delete material that is not the node's. Removal must not follow links.
- **A pending request outlives its turn** if the agent process dies while waiting, or the turn is cancelled. The registry must clear requests whose turn ended, so the indicator never points at nothing.
- **An agent may ignore the once option's meaning** and remember anyway. The application cannot prevent that; it can only never ask the agent to remember.
