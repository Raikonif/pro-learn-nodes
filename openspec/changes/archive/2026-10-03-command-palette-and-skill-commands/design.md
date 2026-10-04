## Context

Commands already exist, scattered: `node-chat/commands.ts` defines `/code`, `/qa`, `/quiz` and builds the composer's `/` menu from them plus the agent's announced commands (`session.offer.offer.commands`); `practice/workbench/kinds.tsx` defines the workbench's add entries; `SessionControls.tsx` sets model, effort, fast mode and mode through `useWorkspaceStore.setNodeAgentSettings`, with a confirmation for modes that act without asking; the rails, the agents panel and the memory panel each have their own store action. Nothing names them together.

Feature boundaries: features import each other only through `index.ts`. `node-chat` already imports `practice`; `app/` composes features.

## Goals / Non-Goals

**Goals:**
- One list of commands that every surface reads; a contributor added later (projects) touches the registry, not the palette.
- Reuse every existing action and guard; the palette never reimplements one.
- No change to the composer's behaviour.

**Non-Goals:**
- Learn Nodes' own skills, a skills folder, or per-node skill activation.
- Rendering the composer's `/` menu from the registry (it already shows exactly the sendable subset; see below).
- Fuzzy search over message content.

## Decisions

### The registry is a function of state, assembled from contributors
`features/command-surface/registry.ts` exports `useCommands(): Command[]`, built from contributors, each a hook returning commands:

```ts
type Command = {
  id: string            // stable: 'workspace.new-session', 'practice.write-quiz', 'session.model:sonnet', 'agent.compact'
  title: string         // 'New session', 'Model: Sonnet 4.5', '/compact'
  group: string         // 'Workspace' | 'Practice' | 'Session' | <agent name>
  description?: string
  keywords?: string[]
  unavailable?: string  // the reason, when it cannot run now
  run: () => void
}
```

Contributors: `workspace`, `practice`, `session`, `agent`. Each lives in `command-surface/` and reads the owning feature's public surface. A command is never hidden for being unavailable; it carries the reason.

*Alternative:* each feature exports its own commands. Rejected for now: it would make every feature depend on the registry's `Command` type. It is the obvious move once a fifth contributor appears.

### Sendable commands are placed, never sent
`/code`, `/qa`, `/quiz` and each agent command become palette commands whose `run` calls `placeInComposer('/name ')`. The palette never starts a turn: the learner finishes the request and sends it, exactly as from the `/` menu. The agent group drops names Learn Nodes reserves (`code`, `qa`, `quiz`), the same rule as `suggestMenu`.

### The composer menu stays as it is
The composer already offers exactly the commands that can be sent in a message, from the same sources (`PRACTICE_COMMANDS`, the agent's offer). The registry imports `PRACTICE_COMMANDS` from `node-chat` instead of redefining them, so the two cannot disagree. Workspace actions in the composer menu would be wrong there: choosing one would leave a `/new-session` the learner could send.

### Session commands go through the existing setter
Model, effort and fast mode values become `session.<control>:<value>` commands calling `setNodeAgentSettings(nodeId, { [control]: value })`. Modes in the asking and editing groups do the same. Modes in the unasked group are listed with the reason "Acts without asking — choose it in the session controls, where it is confirmed": the confirmation exists in one place. With no offer known yet, every session command is unavailable with "Send a message first, so the agent reports what it offers."

The session's offer lives in `node-chat`'s session store; `node-chat` exports a hook `useSessionOffer(nodeId)` returning the offer, current choices and the agent name, so `command-surface` reads it without reaching into internals.

### Matching and ranking
Lowercased subsequence match over `title`, `group`, `description` and `keywords`. Score: prefix of title > word-start in title > substring > subsequence; ties by shorter title. Available before unavailable within Commands. Nodes match on title; archived nodes are excluded. Each group renders at most 8, with "+N more" when truncated.

### Empty query
Available commands first (group order Workspace, Practice, Session, agent), then up to 5 recent nodes by `lastActivityAt`, excluding the open one.

### Opening the detailed start from outside
`study-launcher` gains a tiny store (`useLauncher`) holding the detailed dialog's open state, used by `DetailedStart` and exported as `openDetailedStart()`. The dialog keeps its single implementation.

### Shortcut and focus
A `keydown` listener on `window` in the capture phase opens on ⌘K (macOS) or Ctrl+K and calls `preventDefault`, so it works with the composer focused and never types into it. The palette is a `role="dialog"` with `aria-modal`, an input with `role="combobox"`, `aria-controls` on a `role="listbox"`, and `aria-activedescendant`. It remembers `document.activeElement` on open and restores it on close. Activating closes first, then runs the command on the next frame, so a command that moves focus (placing text in the composer) wins.

### Account scoping
The palette is mounted inside the signed-in `Workspace`, so it does not exist while signed out, and its node results come from the workspace store, which holds only the active account's graph.

## Risks / Trade-offs

- [Agents announce many commands (Claude: 66)] → they are a group like any other, capped at 8 visible per query, and the empty query shows only the first 8 with "+N more".
- [A session command chosen while the agent is mid-turn] → the setter already records the choice for the next turn; nothing new.
- [⌘K conflicts with a browser shortcut in dev] → `preventDefault` in capture; the Tauri window has no conflicting binding.

## Migration Plan

Frontend only; nothing to migrate. Rollback is removing the mount in `Workspace.tsx`.
