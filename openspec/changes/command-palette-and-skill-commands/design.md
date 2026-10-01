## Context

See `proposal.md - Why` for motivation. The relevant current and near state:

- The skills system (roadmap Phase 5) is a **prerequisite that is not yet built**. Its contract, fixed in `tech-stack.md`, is that a skill is a directory under `~/.learn-nodes/skills/<name>/` holding `skill.yaml` and `body.md`, that the agent receives one merged system prompt equal to the base prompt plus the active skills' bodies, and that "invalid skills [are] silently skipped".
- `Provider.stream_chat` already takes `skills: list[str]` as a per-request argument. Skill influence is therefore already request-scoped at the protocol boundary; what does not yet exist is a caller that varies it from the node's stored list.
- The node is the unit of configuration. `node-chat-threads` states that threads inherit the node's mode, active skills, and MCP servers and that the workspace presents no per-thread control for them. `node-creation-controls` states that a child node inherits its parent's active skills at creation.
- The workspace is three panes with no spare region (`node-workspace-layout`), and it is the root view only while an account is active (`account-identity`). The left rail already owns a node search.
- The WebView has no filesystem access; `~/.learn-nodes/` is reachable only from the Rust host or the Python backend, and the backend already owns local data and the data directory.

Constraints: the app must stay usable while the skills directory is empty or entirely absent; nothing here may require a restart, because mission principle 6 is the property being preserved; and the change must be buildable and testable before Phase 5 exists.

## Goals / Non-Goals

**Goals**

- One place where "what can be invoked" is decided, so a second surface is a renderer rather than a second answer.
- A path from "a folder appeared on disk" to "a learner can run it" that crosses no code.
- Invocation that cannot leave a node configured differently than the learner asked for, including after a crash.
- A composer where the command menu is an offer, never a mode, so message text is never held hostage to it.

**Non-Goals**

- Defining the skill file format, the loader, or prompt merging. Those are Phase 5's; this change consumes them and specifies one amendment to the loader's reporting (see *Decisions*).
- Command arguments, command history, user-defined aliases, or user-rebindable chords.
- MCP tools as commands. They arrive in Phase 6 and would enter the same registry as a further derivation source, which is why the registry is not shaped around skills specifically.
- The remaining Phase 14 shortcuts (⌘N, ⌘F, ⌘B). This change owns one chord.

## Decisions

### The registry is derived by reading a catalogue, not populated by registration

Commands are produced by a pure function over inputs: the loaded skill catalogue, the set of workspace actions, and the current context (is a node open, is the target thread streaming). Nothing "registers" a command.

*Alternative considered — a registration API*, where each feature calls a registry to contribute its commands at module load, which is how editor command palettes are conventionally built. Rejected because it reintroduces exactly the failure this change exists to remove: whether a skill is reachable would depend on code having run, and a skill is not code. It also makes the registry's contents untestable without mounting the features that populate it.

The consequence worth naming: adding a *non-skill* command still takes a code change, because a workspace action is code. That is fine. The property that must hold is that adding a *skill* does not, and derivation gives it unconditionally.

### The catalogue is read by the backend, and the frontend never touches the skills directory

A read route returns the loaded skills and, alongside them, the folders that were rejected with the reason for each. The frontend renders that payload; it has no notion of a directory.

*Alternative considered — a Tauri Rust command reading the directory* and handing the result to the WebView. Rejected because the merged system prompt is assembled in the backend regardless, so the loader must exist there anyway; a second reader in Rust would mean two implementations of "valid skill", and the one the palette shows would be the one that does not decide anything. One loader, one definition of valid, one list of rejections.

### The loader reports what it skipped — an amendment to Phase 5's wording

`tech-stack.md` and roadmap Phase 5 say invalid skills are "silently skipped". This change keeps the *runtime* half of that and rejects the *observability* half: loading stays non-fatal, no invalid folder can break a session or fail startup, but the loader returns rejections rather than discarding them, and the palette renders them.

Silence plus an invisible palette entry is undebuggable. A learner whose skill does not appear cannot distinguish "the folder name is wrong", "the YAML is malformed", "I edited the wrong file", and "the feature is broken" — and the local-first shape of the app means there is no log they will ever open. The palette is where the question is asked, so it is where the answer belongs.

*Alternative considered — write rejections to a log file* and leave the palette clean. Rejected: a desktop learner does not read logs, and the cost of the alternative is a support burden paid forever to save one line in a list.

This is stated as a change to Phase 5's contract rather than smuggled in, because Phase 5 has not been built yet and can absorb it at no cost. Its loader signature becomes "loaded plus rejected", not "loaded".

### Every skill yields two commands rather than one command with a modifier

Running once and activating are different acts with different persistence, so they are different entries with different names.

*Alternative considered — one entry per skill, Enter runs it, a modifier activates it.* Rejected on two counts. First, a modifier does not exist in the composer surface, where Enter already has a meaning and a second chord would be invented for a menu the learner is reading for one word; the two surfaces would stop being equal, breaking the change's central rule. Second, a modifier is undiscoverable, and the palette's whole purpose is discovery — a hidden second behavior on an entry is the same disease as a hidden skill.

The cost is a registry twice the size of the skill set, which fuzzy search absorbs and category ordering keeps legible.

### A one-shot run passes a request-scoped skill list; it never writes and unwrites the node

Running once composes the node's stored skills plus the invoked one and passes that list for a single request. `Node.active_skills` is not touched.

*Alternative considered — write the skill into `active_skills`, issue the request, remove it.* Rejected because a crash, a cancelled stream, or a concurrent activation between the write and the unwrite leaves the node permanently carrying a skill by an action whose entire contract is that it does not change the node. A rollback step that must run for correctness is a rollback step that will eventually not run. The per-request `skills` argument on the provider protocol already exists; using it costs nothing and makes the guarantee structural rather than procedural.

### The composer matches by name prefix; the palette matches by subsequence

In the palette, everything typed is a query and nothing else. In the composer, the same characters are simultaneously a candidate command and a candidate message, and the message must survive. A permissive matcher there keeps a menu open over `/usr/bin/env` — where fuzzy matching finds *something* for almost any token — and an open menu is an Enter away from invoking it. Prefix matching closes the menu at the first character that cannot start a command name, which is the behavior that makes a slash-leading message ordinary again by itself.

*Alternative considered — subsequence matching in both surfaces* for consistency. Rejected: the surfaces differ in what the text is for, and matching the matcher would mean mismatching the risk.

*Alternative considered — an escape syntax*, `//` at position zero sending a literal `/`. Rejected because it rewrites what the learner typed, which is the one thing a composer must not do, and because it is a rule that has to be taught to be usable.

### Enter invokes while the menu is open; Escape is the way back to plain text

With the menu open and a match highlighted, Enter runs the command; Escape closes the menu and leaves every character in place, after which Enter sends.

*Alternative considered — Enter always sends, and invoking requires Tab or a click.* Rejected: it makes the keyboard path slower than the mouse in a surface that exists to be keyboard-first, and it inverts the convention of every coding-agent composer a learner arrives already knowing. The residual surprise — a learner meaning to send `/quiz` — costs one Escape, is visible before it happens because the highlighted entry is on screen, and is recoverable because nothing was consumed.

### Unavailable commands are listed with a reason instead of filtered out

A command that cannot run right now stays in the results, marked, with the reason.

*Alternative considered — show only what can run*, which is the Spotlight convention and produces shorter lists. Rejected because it makes absence ambiguous in exactly the way this change exists to fix: "no such skill" and "not applicable while the graph is showing" would look identical, and the learner cannot tell which question to go and answer. A short list that lies about the world is worse than a long list that does not.

### With no node open, a skill command reports its precondition and creates nothing

*Alternative considered — invoking a skill with no node open creates a node and runs the skill in it.* Rejected: it produces graph nodes as a side effect of a search box, and the graph is the product (mission principle 2). A node that exists because someone pressed Enter in a palette is a node nobody chose to make.

### A palette-invoked run lands in the thread the learner has open

*Alternative considered — always deliver into the node's main thread*, which needs no notion of a current thread. Rejected: it puts output somewhere the learner is not looking, and `node-chat-threads` already establishes the open thread as the center region's subject. Activation, by contrast, is deliberately node-scoped, which is what keeps threads from acquiring a private configuration the thread spec forbids.

### The empty query leads with commands, not with recent nodes

*Alternative considered — recent destinations first*, the Raycast and Spotlight ordering. Rejected here because navigation is already served three ways — the left rail by recency, the center graph, the right-rail minimap — while commands have no other home at all. The roadmap's demo for this phase is "drop a skill folder, press ⌘K, it is listed", and a palette that opens on a recency list fails that demo on a machine with a busy graph.

### The palette does not exist while signed out

*Alternative considered — a reduced signed-out palette* offering sign-in and settings. Rejected: commands, nodes, and projects are all account-scoped, so the reduced set would hold one entry, and that entry is already the entire content of the sign-in surface.

### The command surface is its own frontend feature

`features/command-surface/` exports the palette, the composer menu, and the registry hook through its `index.ts`. Two consumers need it — the workspace shell mounts the palette and its chord, `node-chat` mounts the menu in the composer — and a feature may not reach into another feature's internals. Putting it inside `node-chat` would either make the workspace import a private path or duplicate the registry, and a duplicated registry is two answers to the question this change exists to answer once.

## Risks / Trade-offs

- **Phase 5 does not exist yet, so the catalogue has no source.** → Every requirement here is satisfiable and testable against an empty or fixture catalogue: the registry yields its non-skill commands, the palette renders, and the composer menu behaves. The skill-derived rows arrive when the loader does, with no change to either surface. The one thing Phase 5 must land differently than currently written is the rejection reporting above.
- **A skill installed while the app is running is not visible until the catalogue is read again.** → A "reload skills" command lives in the registry itself, requires no open node, and is reachable from both surfaces; the specs require only that the commands appear "once the catalogue is next read", so a filesystem watcher can replace the explicit reload later without a spec change.
- **A learner's ordinary message could still collide with a real command name**, since skill names are folder names and a folder could plausibly be named after a common word. → Nothing is transformed and nothing is consumed: Escape restores plain text, the highlighted entry is visible before Enter, and no message is ever silently swallowed.
- **The registry doubles the skill count and competes with node titles for palette space.** → Fixed category order with per-category caps and an explicit truncation indicator, so a large graph cannot push commands off the list and a large skill set cannot bury a node.
- **Activation writes the node's stored skill set, and children created afterwards inherit the newer set** (`node-creation-controls`). A learner may not connect a palette keystroke to what a child node inherits later. → This is the correct behavior for a node-scoped setting rather than a defect; the toggle names its direction and the node's active skills remain visible in the node's own configuration surface.
- **The chord is hard-coded and macOS-shaped.** → One chord, one change; Phase 14 owns the shortcut set and can take rebinding with it.

## Migration Plan

No schema migration and no data migration. The activation command writes the node's existing active-skill field; if that field does not yet exist when this change is built, it is introduced by the skills change that owns it, not here. The registry, both surfaces, and the catalogue read route are additive: no existing route changes signature and no existing behavior is removed.

Rollback is removing the two surfaces and the catalogue route. The only durable state this change can produce is a different value in a node's active-skill list, which is a value the learner could equally have set from the node's own configuration, so no rollback repair is required.

## Open Questions

- Whether the catalogue is re-read by a filesystem watcher instead of the explicit reload command. The specs require only that new skills appear once the catalogue is next read, so this is a later substitution that changes no contract.
- The visual treatment distinguishing an unavailable entry from an available one, and whether a rejected skill's reason is shown inline or on focus. The spec requires only that the reason be present and that the entry not be activatable.
- Whether MCP tools become a fourth palette category in Phase 6 or a further source of commands within the existing Commands category. Either fits the derivation model; it is decided when there are MCP tools to look at.
