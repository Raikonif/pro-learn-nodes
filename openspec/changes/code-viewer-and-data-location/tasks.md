## 1. Code viewer: backend

- [x] 1.1 `service/code_files.py`: list a node's code files (recognised extensions, relative paths, size, viewable or the reason not: too large over 1 MB, not text), excluding `practice/`; read one; every path resolved and checked with `inside()`, links leaving the folder skipped; tests including a link out, `..`, a binary, a large file, a missing directory
- [x] 1.2 Routes `GET /workspace/nodes/{id}/code` and `GET /workspace/nodes/{id}/code/file?path=`; another account's node answered as missing; route tests

## 2. Code viewer: frontend

- [x] 2.1 Dependencies: `@lezer/highlight`, `@lezer/python`, `@lezer/javascript`, `@lezer/json`, `@lezer/html`, `@lezer/css`, `@lezer/markdown`; language detection by extension and fence info string
- [x] 2.2 `features/code-viewer/highlight.ts`: parse, `classHighlighter` ranges split per line, error nodes as diagnostics (line, column, range); unrecognised language → plain lines; tests per language and for a syntax error
- [x] 2.3 `CodeView` component: line-number gutter, token spans coloured with Tailwind arbitrary variants (light and dark), diagnostic underline, gutter markers and list, "syntax checks only" / "no syntax problems found" / "language not recognised" notes, read-only; component tests
- [x] 2.4 Conversation code blocks: parse fenced blocks out of agent message text; render them in the conversation as `CodeView` with "Open in Code"; tests
- [x] 2.5 `code-sources` store: working-directory files (refreshed when a turn ends and on tab open), practice code exercises with current solution, conversation blocks; grouped and labelled; `hasCode` per node; tests
- [x] 2.6 Center-region tabs Conversation | Code: Code offered only when `hasCode`; default Conversation; switching keeps the turn streaming and marks the conversation tab while a turn runs; source list beside the view; not-viewable entries show their reason; component tests
- [x] 2.7 Practice `CodeTool` statement and solution previews use `CodeView`

## 3. Data location: sidecar

- [x] 3.1 Data check at start: folder exists, database opens, `PRAGMA quick_check`, migrations; `/ready` reports `data: {status: ok|missing|damaged, detail}`; a missing folder named explicitly (`--data-dir` with `--require-existing`) is not created; tests for each status
- [x] 3.2 Check that nothing stored in the database is an absolute path into the data folder (node directories derived each time); test that a moved folder opens with every session, practice item, and remembered decision intact

## 4. Data location: Tauri shell

- [x] 4.1 `data-location.json` in `app_config_dir()` (`path`, `previous`, `move`); absent → `app_data_dir()`; the Unix socket moves to `app_cache_dir()`; Rust unit tests
- [x] 4.2 Target check: writable, empty or absent, not inside the current folder nor containing it, free space with margin, warning for a cloud-synced folder; Rust tests
- [x] 4.3 Copy with manifest (relative path, size, SHA-256), links copied as links never followed; verify against the manifest; progress events (bytes of total); Rust tests including a link and a mismatch
- [x] 4.4 Move command: record `copying` → stop sidecar → copy → verify → `switched` → start on the new folder → wait for `data.status == ok` → remove previous contents without following links → `done` with leftovers; roll back on any failure before removal; resume or undo an interrupted move from `move.state` at start; Rust tests with a fake sidecar
- [x] 4.5 Restore at start when `data.status` is not ok: previous location if it still holds the data, else the newest backup passing the integrity check; report what was restored and from when; otherwise the error state with retry / choose folder / default; Rust tests
- [x] 4.6 Tauri commands and events exposed to the frontend: current location and what it holds, choose folder (`@tauri-apps/plugin-dialog`), start move, progress, retry removal, reveal folder, recovery outcome

## 5. Data location: frontend

- [x] 5.1 Settings → Data location: current path and contents, Change… (folder picker), refusal reasons, synced-folder warning, progress while moving; unavailable with the reason in the browser build
- [x] 5.2 Outcome notices: move completed; move abandoned and why; leftovers in the previous folder with Retry and Reveal; restored from the previous location or from a backup (with its date)
- [x] 5.3 Start-up error screen when no good copy exists: what is missing or damaged, Retry, Choose another folder, Start on the default folder
- [x] 5.4 Component tests for 5.1–5.3

## 6. Verification

- [x] 6.1 E2E `code-viewer.spec.ts` on the fake agent: no Code tab without code; the agent writes a file and the tab appears; a fenced block opens in Code; a Python file is coloured and numbered; a syntax error is marked; a turn keeps streaming while Code is shown; 800×600
- [ ] 6.2 Full suites green; rebuild sidecar and bundle; in the built app: move the data to a new folder and continue a session there; make a file in the previous folder unremovable and see it reported, then retry; disconnect or rename the new folder and see the application restore or report it; open the Code tab on a node where a real agent wrote code
