## Why

Skills are configured but unreachable. A learner can drop `~/.learn-nodes/skills/<name>/` on disk and the loader will read it, but nothing in the window ever names it: the only way a skill influences a session is through a toggle set at node creation, which means a skill installed after the node exists is invisible until the node is recreated. Worse, an invalid skill is silently skipped, so "my skill does nothing" and "my skill was never loaded" look identical from the workspace.

This change gives skills a surface. It introduces one derived command registry and renders it in two places — a ⌘K palette over the workspace and a `/` menu in the conversation composer — so that installing a skill folder makes it invocable with no UI work, and a skill that failed to load says so instead of vanishing.

## What Changes

- Add a **command registry**: one set of invocable commands assembled at runtime, whose skill entries are derived from the loaded skill catalogue rather than declared in code. A skill folder added to `~/.learn-nodes/skills/` contributes its commands on the next catalogue read; no code, route, or component changes.
- Every loaded skill contributes exactly **two commands**: run the skill once against the open conversation, and activate/deactivate the skill for the open node. Running once never alters the node's stored active skill set; activating takes effect on the next request without a restart, keeping mission principle 6 intact.
- Add the **⌘K command palette**, an overlay over the workspace that searches commands, nodes, and projects in one query, is fully keyboard-operable, and dismisses on Escape without side effects.
- Add the **`/` command menu in the conversation composer**, rendering the same registry. A command reachable in the palette is reachable in the composer and vice versa. The composer never rewrites what the learner typed — a message beginning with a literal `/` remains sendable.
- Commands declare whether they need an open node. With no node open, a node-requiring command is **listed and marked unavailable with the reason**, never hidden, and invoking it neither creates a node nor fails silently.
- **Skills that failed to load are surfaced in the palette** as unavailable entries naming the folder and the reason. Loading stays non-fatal — a broken skill still cannot take down a session — but "silently skipped" becomes "skipped, and here is which one and why".
- The palette is a workspace surface: while no account is active there is no workspace, no composer, and no palette.

## Capabilities

### New Capabilities

- `command-registry`: The single runtime set of invocable commands — how skill commands are derived from the loaded catalogue, how a command is identified and named, when a command is available, and how a skill folder that failed to load is reported rather than dropped.
- `command-palette`: The ⌘K overlay — opening and dismissal, the query, the result categories and their ordering, keyboard traversal and activation, empty and no-result states, and behavior while signed out.
- `composer-slash-commands`: The inline command menu in a conversation composer — when it opens, how a command is chosen, and how an ordinary message beginning with `/` stays ordinary text.
- `skill-command-invocation`: What invoking a skill actually does — the one-shot run and the node-scoped activation toggle, their effect on the node's stored configuration, and their behavior when no conversation is open.

### Modified Capabilities

- `node-workspace-layout`: adds the palette as an overlay above the three panes that never becomes a fourth pane and never displaces the left rail's node search.
- `node-chat-threads`: clarifies that a skill command invoked from a spawned thread's composer changes the owning node's configuration, not the thread's, so threads still cannot hold a private skill set.

## Impact

- **Frontend**: new `features/command-surface/` exporting the palette, the composer menu, and the registry hook through its `index.ts`; `features/node-chat/` gains the composer menu mount point; `app/App.tsx` mounts the palette and its key binding within the account-gated workspace. `shared/lib/` gains the registry client.
- **Backend**: a read route exposing the loaded skill catalogue together with the entries that failed to load and why; a route to run a skill once against a thread and a route to change a node's active skill set. `service/` gains the catalogue read and skill-invocation orchestration; `models/Node.active_skills` is written by the activation command.
- **Depends on Phase 5 (`skills-system`), which is not yet built.** The skill loader must report rejected folders instead of discarding them — see `design.md - Decisions`. Until Phase 5 lands, the registry has commands but no skill entries, and every requirement here is still satisfiable and testable with an empty catalogue.
- **Not in scope**: the ⌘N, ⌘F, and ⌘B shortcuts listed in Phase 14, MCP tools as commands, and command history or aliases.
