## Why

A node's code now lives in several places — files an agent writes in the node's working directory, the exercises and solutions practice keeps, code the agent quotes in the conversation — and none of them can be read as code: practice shows plain monospaced text, and the working directory cannot be seen at all. Learners who use Codex desktop expect to open that code in a tab, coloured by what each token is, with line numbers and the problems a linter would point out.

Separately, everything the application stores lives in one folder the learner never chose and cannot change. A learner who wants their graph on another disk, or in a folder they back up, has no way to move it — and moving it by hand breaks the sessions that point into it.

## What Changes

- Add a **Code tab** to the center region of an open node, beside its conversation, in the manner of Codex desktop. It lists the code that exists for the node — files in its working directory, its code exercises with the learner's current solution, and code blocks in its conversation — and opens one read-only with syntax highlighting, line numbers, and lint diagnostics. The tab is offered only when the node has code somewhere; it never shows an empty editor.
- Add a **data location** setting. The learner chooses a folder; the application stops its backend, copies the whole data folder there, verifies the copy, switches to it, and only then removes the previous folder's contents.
- **Recover from a move that went wrong.** If removing the previous folder's contents fails, the learner is told what was left behind and can retry; nothing at the new location depends on it. If after a move — or at any start — the data a session relies on is missing or damaged, the application says what is broken and, when the previous location or the move's restore point still holds a good copy, restores it automatically.

## Capabilities

### New Capabilities

- `code-viewer`: where a node's code is found, when the Code tab is offered, and how code is shown — highlighting, line numbers, lint diagnostics, read-only.
- `data-location`: choosing where the application's data lives, moving it there whole, removing the previous copy, and detecting and restoring data a move or a missing folder broke.

### Modified Capabilities

- `node-workspace-layout`: the center region of an open node holds a Code tab beside the conversation; still three panes.

## Impact

- **Frontend**: new `features/code-viewer/` (tab, file list, read-only viewer); Lezer parsers (`@lezer/python`, `@lezer/javascript`, and the other languages listed in the design) with `@lezer/highlight`, rendered by our own component and coloured with Tailwind — not the CodeMirror editor, which injects its own stylesheet; code blocks in agent messages become recognisable as code; `features/settings/` gains the data-location section and the recovery notices. Practice's `<pre>` blocks may reuse the viewer.
- **Backend**: a read-only route listing and reading code files within a node's working directory (never outside it); a data-integrity check the sidecar reports at startup.
- **Tauri shell (`src-tauri/src/lib.rs`)**: the data folder is read from a small location pointer kept in the platform's app-config folder, not hard-wired to `app_data_dir`; the move (stop sidecar, copy, verify, switch, restart, remove old) runs in Rust, because the sidecar holds the database open; `@tauri-apps/plugin-dialog` for choosing the folder.
- **Agents**: a node's working directory path changes with the data folder, so an agent's own session for that node may not load after a move; the existing hand-over with a continuity seam covers it.
- **Depends on**: `acp-agent-permissions` (the node directory's contents and lifetime), `practice-workbench`.
