## Why

An agent sees one thing: the conversation it is running. It cannot see the learner's other sessions, the practice they did, or what another agent was told — so Codex and Claude, working for the same learner on the same device, share nothing but what the learner re-types. The application already holds all of it, locally: sessions, transcripts, and (with `practice-rail-foundation`) questions, attempts, and sandbox code. What is missing is a way for an agent to reach it.

A spike on 2026-10-01 settled how. Both Codex (`codex-acp` 2.0.1) and Claude (`claude-agent-acp` 0.84.0) accept an MCP server handed to them in `session/new`, call its tools for reading and for writing, and forward an `Authorization` header on every call. Neither asks permission before calling an MCP tool — so the server's own rules are the only control, and they have to be the right ones.

## What Changes

- **A local MCP server inside the backend**, handed to every agent session through ACP's `mcpServers`. It listens on loopback only and admits a call only with a per-session bearer token, minted when a session is opened or loaded and bound to one account and one node.
- **Session tools**: list and search the learner's sessions, read a session's conversation, and title the current session when it has no title the learner chose.
- **Practice tools**: read a session's questions, exercises, attempts, and code; add a question, a quiz question, or a **code exercise** to the current session. This is the "second producer" `practice-rail-foundation` designed for: agents write the same item rows a learner does, marked with the agent that wrote them.
- **Practice is delivered to the rail, not answered in the chat.** When an agent adds practice, the right rail switches to the tool it belongs to — Code, Q&A, or Quiz — and highlights it, and the conversation records a line that leads there. The learner asks for it either in plain words ("send it to Code") or with a composer command: `/code`, `/qa`, `/quiz`.
- **Code exercises.** A new item kind: a statement, starter code, and optionally the output a correct program prints. The learner solves it *in the Code tool*, in a buffer of its own; submitting records an attempt holding their code and the run's result. The agent has access to it — the exercise and the learner's current solution are files in the node's directory, the agent's working directory, and are readable through the practice tools.
- **Shared memory**, the core of roadmap Phase 11: any agent may *propose* a fact about what the learner knows; the learner accepts, edits, or rejects it; accepted facts are readable by every agent in every session. Proposals are never in effect until accepted.
- **Additive only.** No tool updates, deletes, or overwrites anything — not an item, an attempt, the learner's code in any buffer, a memory, or a learner-chosen title. An agent proposes an exercise; only the learner writes its solution. Since agents do not ask before calling these tools, the server offers nothing that would need asking about.
- **Every call is visible**: an agent's tool calls are already recorded in the conversation as tool activity; agent-authored practice items and memory proposals name the agent that made them.

## Capabilities

### New Capabilities

- `agent-context-server`: the local MCP server — how an agent reaches it, how a call is scoped to an account and a node, what it may read and write, and what it refuses.
- `shared-memory`: facts proposed by agents, decided by the learner, and shared across agents and sessions once accepted.
- `practice-delivery`: practice an agent creates arrives in the rail's tool for it, visibly and in the moment, and can be asked for by command or in plain words.

### Modified Capabilities

- `practice-items` (introduced by `practice-rail-foundation`): an item records who authored it; a third kind, the code exercise, is solved in the Code tool and submitted as an attempt.
- `code-sandbox` (introduced by `practice-rail-foundation`): besides the node's free buffer, each code exercise has a buffer of its own, and the exercise and its solution are readable by the node's agent as files.

## Impact

- **Backend**: `service/context_server/` (the MCP app, token registry, tool handlers over existing services), an in-process loopback listener started in the lifespan beside the supervisor; `service/agent/sessions.py` passes `mcpServers` on `session/new` and `session/load`; `models/memory.py`, `repository/memory_repo.py`, memory routes; one migration (memory table, practice-item author column).
- **Dependency**: the official MCP Python SDK, pinned. It is 2.x as of the spike (`FastMCP` renamed `MCPServer`); PyInstaller bundling is verified before it is adopted, as `acp-agent-backend` did for its own dependency question.
- **Frontend**: the rail switching to delivered practice and highlighting it; the Code tool's exercise list and per-exercise buffer with Submit; `/code`, `/qa`, `/quiz` in the composer; a memory panel (review, accept, edit, reject; list and export accepted facts); an author mark on agent-written practice items.
- **Depends on** `practice-rail-foundation`, which must be applied first. **Delivers** the core of roadmap Phase 11. **Distinct from** Phase 6, which is the opposite direction — the application *consuming* external MCP servers.
- **Not in scope**: agents running or editing sandbox code; grading free-text answers; injecting memory into prompts (agents read it through the tool).
