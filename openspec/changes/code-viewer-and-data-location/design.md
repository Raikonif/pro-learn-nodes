## Context

See proposal.md for why. The state this design starts from:

- **Code exists in three places, none viewable as code.** A node's working directory (`agent-workspaces/<node_id>`) holds what its agent wrote and practice's mirror of each exercise (`practice/<id>-<slug>/README.md`, `solution.py`). Practice records hold each exercise's statement, starter code, and the learner's solution, shown in `CodeTool.tsx` as plain `<pre>`. Agent messages are stored and rendered as plain text, so a fenced code block is just text with backticks.
- **The workspace is styled with Tailwind utilities only** (`node-workspace-layout`): no custom CSS files, no stylesheet loaded, no inline style except a rail's width property.
- **The data folder is hard-wired.** `spawn_production_sidecar` in `src-tauri/src/lib.rs` uses `app_data_dir()` for the database, `backups/` (a copy taken before each migration by `core/migrations.py`), `agent-workspaces/`, and the sidecar's Unix socket. Nothing in the database records an absolute path into that folder; the node directory is derived from the data folder each time (`node_directory(data_dir, node_id)`).
- **Secrets are not in the folder.** The active-account pointer and agent credentials live in the platform keychain, so they need no moving.
- **Agents remember sessions by working directory.** A node's directory path changes when the data folder moves, so an agent's own record of that node's session may not load; `TurnService` already falls back to a fresh session handed the transcript, with a continuity seam.

## Goals / Non-Goals

**Goals:**
- One read-only viewer for every kind of code a node has, offered only when there is some.
- Moving the data folder never leaves the learner with less data than before, at either location.
- A folder that is missing or damaged at start is reported, and restored where a good copy exists — never silently replaced by an empty one.

**Non-Goals:**
- Editing code in the Code tab; practice's own editor stays the place to write a solution.
- Semantic lint — undefined names, unused imports, type errors. Diagnostics here are what a parser can prove: syntax errors.
- Moving data the application does not own: the keychain, and the agents' own session stores.
- Choosing a data location in the browser development build; there is no Tauri there to stop and restart the backend.

## Decisions

### The Code tab is a tab in the center region, not a pane

An open node's center region gains a tab strip — **Conversation | Code** — as Codex desktop places its file view beside the thread. The workspace stays three panes; the right rail, minimap, and practice tools are untouched. The Code tab appears only when the node has at least one code source, and the conversation keeps streaming while Code is shown, with the tab marking that a turn is running.

*Alternative:* a fourth pane or a right-rail tool. Rejected: the layout spec forbids a fourth pane, and the right rail is already practice's.

### Three sources, listed together, each labelled by where it comes from

- **Working directory files**, from a new read-only backend route: listing and reading files under the node's directory, recognised by extension, at most 1 MB each, skipping binaries. Every path is resolved and checked to lie inside the directory — the same `inside()` test `service/agent/permissions.py` uses — so a link that leaves it is not followed. Practice's mirror under `practice/` is excluded: it is a projection of the practice record, which is listed instead.
- **Practice code exercises**, from the practice store the client already has: the starter code and the learner's current solution.
- **Conversation code blocks**, parsed client-side from fenced blocks in agent messages; the fence's info string names the language. Agent messages also render those blocks as code in the conversation, with an "Open in Code" action.

### Lezer parsers and our own renderer, not the CodeMirror editor

The view is read-only, so the editor buys nothing but a stylesheet. CodeMirror 6 injects its theme through `style-mod`, a stylesheet the layout spec does not allow. The parsers underneath it do not: `@lezer/python`, `@lezer/javascript` (JavaScript, TypeScript, JSX), `@lezer/json`, `@lezer/html`, `@lezer/css`, `@lezer/markdown`, plus `@lezer/highlight`'s `classHighlighter`, which emits `tok-keyword`, `tok-function`, `tok-className`, … class names. The renderer turns the highlighted ranges into spans per line, with a line-number gutter, and the container colours them with Tailwind arbitrary variants (`[&_.tok-keyword]:text-violet-700` and so on), in light and dark.

Diagnostics come from the same parse: Lezer marks what it could not parse with error nodes, and each becomes a diagnostic — an underline on the range, a marker in the gutter, and a list under the code with line, column, and "Syntax error". An unrecognised language is shown with line numbers and no colour or diagnostics, and says so.

*Alternatives:* Shiki (exact colours, but a WASM grammar engine, large, and no diagnostics); Prism (regex tokens, no parse tree, no diagnostics).

### The data folder is named by a pointer outside it

Tauri reads `data-location.json` from `app_config_dir()`: `{ "path", "previous", "move" }`. Absent, the data folder is `app_data_dir()` as today, so existing installs change nothing. The sidecar's Unix socket moves out of the data folder into `app_cache_dir()`: a socket path is limited to about 104 bytes, and a learner's folder can be deeper than that.

### Moving copies, verifies, switches, and only then removes

A Tauri command runs the move, because the sidecar holds the database open and must be stopped first:

1. **Check the target.** It must be writable, empty or absent (never merged into), not inside the current folder nor containing it, and have room for the data plus a margin.
2. **Record the move** in the pointer: `move: { state: "copying", from, to }`.
3. **Stop the sidecar** — SQLite checkpoints on close; the `-wal` and `-shm` files are copied as they are anyway.
4. **Copy** the whole folder, symbolic links copied as links and never followed, building a manifest of every file's relative path, size, and SHA-256.
5. **Verify** the copy against the manifest; any difference abandons the move (step 8).
6. **Switch**: the pointer becomes `{ path: to, previous: from, move: { state: "switched" } }`; the sidecar starts on the new folder, and the move proceeds only when `/ready` reports the data healthy (next decision).
7. **Remove the previous folder's contents**, never following links out of it. Failures are collected; the pointer records `move: { state: "done", leftovers: [...] }` and the learner is shown what remains, with Retry and Reveal in Finder. The new folder is complete without them.
8. **Roll back** on any failure before step 7: the pointer returns to `from`, the sidecar restarts there, and the partial copy is removed. The learner is told the move did not happen and why.

A move interrupted by a crash is finished or undone at the next start from the recorded `move.state`: `copying` → undone; `switched` → verified again and completed.

*Alternative:* a rename when both folders are on one volume. Rejected for now: it would be a second path to keep correct for a saving that matters only for large folders.

### The sidecar reports whether its data is usable; Tauri restores

At start the sidecar checks that the data folder exists, that the database opens, passes `PRAGMA quick_check`, and migrates. `/ready` adds `data: { status: "ok" | "missing" | "damaged", detail }`. A missing folder is never created afresh when the pointer names a location that existed before — an unplugged drive must not become an empty graph.

When the data is not `ok`, Tauri restores from the first good source, in order:
1. **The previous location**, while the pointer still names it and its contents have not been removed — the case of a move whose new folder is unreadable.
2. **The newest copy in `backups/`** that passes the integrity check — the case of a damaged database; the notice states when that copy was taken, so the learner knows what may be missing.

If one succeeds, the application starts on it and shows what happened. If none does, it shows an error naming the folder and what is wrong, with: choose another folder, retry, or start on the default folder — never chosen for the learner.

A node directory missing after a move is not damage: it is recreated empty on the next turn, and the practice mirror is rewritten on the learner's next save. An agent session that will not load at the new path is handed over with the existing continuity seam.

### The Keychain item follows the data, not its path

*Found when the move was run against the real sidecar.* The active-account pointer is a Keychain item whose service name was a hash of the data folder's path — so that the E2E suite, `pnpm dev`, and an install do not share one pointer. After a move the path differs, so the learner came back signed out. The data folder now carries its own identity, `.learn-nodes-id` (16 random hex characters, made at the first start that finds the folder usable), and the Keychain service is named after it; the identity moves with the data, and separate installs still have separate items. A folder without one is named by its hashed path as before, and the first start that gives it an identity carries the pointer over, so no existing install is signed out by the upgrade.

### Stopping the sidecar waits for it to be gone

*Found the same way.* `stop_sidecar` sent SIGTERM and returned at once, so a move could copy — and a restore replace — a database the old process still had open. It now waits up to 10 s for the PyInstaller bootloader to exit (it exits only after its Python child; `waitpid` also collects an exit nobody reaped), and uvicorn's graceful shutdown is bounded at 5 s so an open stream cannot hold it. Past 10 s the Python child is killed first, then the bootloader, so no process is left holding the database.

## Risks / Trade-offs

- [A large folder takes a long time to copy] → the move reports progress (bytes copied of total) and cannot be started twice; the window stays responsive.
- [A cloud-synced target (iCloud Drive, Dropbox) can corrupt a live SQLite database] → the target check warns when a folder looks synced, and the learner may still choose it.
- [Removing the previous contents deletes files] → only after the new copy is verified and running, never following links, and a failure leaves files rather than retrying silently.
- [Restoring from `backups/` loses work since that copy] → only when the database cannot be used at all, and the notice says from when the copy is.
- [The Code tab reads files an agent wrote] → read-only, inside the node directory only, size-capped; no file is executed or interpreted.
- [Syntax-only diagnostics may disappoint as "lint"] → the viewer says which checks ran; semantic lint is a later change.

## Migration Plan

- No pointer file on existing installs: the data folder stays `app_data_dir()`, and only the socket moves to `app_cache_dir()`.
- No database migration.
- Rolling back the application version: an older build ignores the pointer and reads `app_data_dir()`; a learner who moved their data would see an empty folder there. The release notes say to move back to the default before downgrading.
