## Context

`acp-agent-backend` connects agents, streams turns, and continues conversations across restarts. It answers every `session/request_permission` with a visible refusal, gives each node an empty working directory, and does not define branching on agent backends. This change closes those three gaps. Decisions below were taken with the learner-facing trade-offs in view on 2026-09-30.

## Decisions

### A node gets a directory, and that turns a mismatch into a feature

`session/new` requires a working directory. A learning application has no repository, and the reflex is to invent a throwaway path.

Giving each node its own directory is better than a throwaway on every axis. It bounds what the agent's file tools can reach to exactly one node's material. It gives the node's attachments a real location, so `fs/read_text_file` becomes the mechanism by which the agent reads the PDF the learner uploaded — which Phase 3's file attachments and Phase 13's BTP both need anyway. And node deletion becomes a directory removal rather than a scattered cleanup.

The directory must not contain the application's data store, and must not be a parent of another node's directory.

### Permissions: read inside the node is automatic, everything else is asked

`session/request_permission` is a **required** client method. An agent will block on it. A request the learner never sees is a conversation that hangs with no explanation — the same class of dead end `first-launch-entry` exists to remove.

The policy: reading within the node's own working directory is granted without asking, because that directory holds only material the learner attached to this node and prompting for it would train the learner to approve without reading. Writing, acting outside the directory, and executing anything are always asked.

Remembered decisions are scoped to what the learner chose and never cross agents or accounts. A permission remembered under one account and applied under another would breach the profile partition that `profile-scoped-data-access` establishes.
### The prompt lives in two places

Inline, next to the turn that caused it, because that is where the learner can judge it. And a workspace-level indicator for requests from nodes that are not on screen, because the spec forbids a request being lost or failed merely for being out of view — and a learner running two nodes on agents at once is the ordinary case, not the edge.

Both are views of one pending-request registry in the backend. A request is decided once; whichever surface answers first wins and the other clears. The SSE stream announces a request; the decision arrives on its own route. That keeps the transport unidirectional, as `acp-agent-backend` chose.

### Branching opens a fresh session and replays up to the branch point

Both measured agents report `session/fork`. It is not used for branching. A fork copies a session as it stands; a branch in this graph anchors to a passage partway through the parent, and must include nothing after it. Cutting a native fork at a passage is not something the protocol offers.

A fresh session handed the parent's recorded transcript up to the anchor, with the passage named as the reason, satisfies the spec on every agent and reuses the replay primitive that restart continuity already needs. The cost — a full context pass on the child's first turn — is paid once per branch, and prompt caching on the agent side softens it.

A native-fork fast path for branches taken at the parent's last turn is a possible later optimisation, deliberately not built now: it would be a second path to keep correct for a saving that occurs only on one kind of branch.

## Risks / Trade-offs

- **Prompt fatigue.** Asking for every write trains approval without reading. Remembered decisions scoped to a node are the mitigation; broader scopes are offered but never defaulted.
- **Deleting a node deletes files.** The directory now holds attachments; a removal that follows a symlink out of it would delete material that is not the node's. Removal must not follow links.
- **A pending request outlives its turn** if the agent process dies while waiting. The registry must clear requests whose turn ended, so the indicator never points at nothing.
