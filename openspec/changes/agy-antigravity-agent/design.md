## Context

The learner wants their Google subscription reachable the way ChatGPT and Claude already are. The only Google client that accepts a personal Google sign-in is Antigravity's `agy`, which authenticates with Google OAuth itself.

That OAuth is `agy`'s, not this application's. Performing it here — registering as a Google OAuth client, holding the learner's tokens, calling Antigravity's backend directly — is the route `acp-agent-backend` rejected permanently: another product's credential, an undocumented endpoint, and consumer terms that do not contemplate it. This change keeps the same line. `agy` signs in; this application launches `agy`.

## Spike results (2026-09-30, `agy` 1.2.14, `gemini-3.8-flash-low`)

| Question | Result |
|---|---|
| Signed in with the learner's Google account | Yes — `agy models` lists models; no credential touched here |
| Speaks ACP | No. No flag, no subcommand |
| Headless protocol | `--input-format stream-json --output-format stream-json --print=""` (`-p` requires a value even when input is stdin) |
| Input line | `{"event":"user","message":{"role":"user","content":"…"}}`; other events are ignored with a warning |
| Output events | `init` (`conversation_id`, model, cwd, tools), `step_update` (`step_type`: `user_input` / `agent_response` with `text_delta` / `tool` with `tool_name`, `tool_info`, `state` ACTIVE→DONE / `system_message`), `result` (`status`, `response`, `usage`, `num_turns`) per turn |
| Several turns in one process | Yes — a fact from turn 1 recalled in turn 2 |
| Resume in a fresh process | Yes — `--conversation <id>` recalled it (≈27s for a 3-turn conversation) |
| Asks before writing a file | **No** — `write_to_file` ran with no request event |
| Asks before running a command | **No** — `run_command` ran `date` with no request event |
| `--mode plan` prevents writes | **No** — it wrote the requested file, and an `implementation_plan.md` under `~/.gemini/` |
| `--sandbox` contains the terminal | Yes — a shell write outside the cwd failed with `operation not permitted` |
| `--sandbox` contains the file tool | **No** — `write_to_file` wrote outside the cwd |

## Mapping onto the `Agent` contract

Everything but permissions maps cleanly, which is what makes this worth recording:

| `Agent` | `agy` |
|---|---|
| `new_session(cwd)` | spawn in `cwd`; `init.conversation_id` is the session id |
| `load_session(id, cwd)` | spawn with `--conversation <id>` |
| `prompt(id, text)` | write one `user` line; map `text_delta` → `TextChunk`, `tool` steps → `ToolActivity`, `result.usage` → `Usage`, `result.status` → `TurnEnded` |
| `cancel(id)` | unknown — no cancel message was found; terminating the process is the only measured option |
| `negotiation.load_session` | true |

## Decision: deferred until `agy` can be contained

Options considered with the learner:

- **A macOS `sandbox-exec` profile** limiting writes to the node directory and `agy`'s own state. Real containment, on a deprecated Apple mechanism, with the set of paths `agy` needs still to be discovered.
- **Informed consent** — a warning that the agent acts without asking and can write wherever the learner's account can. Simple; the protection is only as good as the reading of a warning.
- **Both.**
- **Wait for `agy`.** Chosen.

Waiting keeps one rule for every backend rather than a weaker one for the backend that cannot meet it. The requirement this change adds to `agent-backends` states that rule, so the decision is enforced by the spec rather than by memory.

## Re-entry criteria

Resume when either holds — `spike/agy_probe.sh` checks both:

1. `agy` speaks ACP. It then needs no new client: it is registered by command like Codex and Claude, and inherits their permission handling.
2. Headless `agy` emits a request before writing or executing, that the client can answer, **and** a refused request does not happen.

Neither alone is enough if it holds only for the terminal: the spike's failure was the file tool.

## Open questions (for re-entry)

- How is a turn cancelled without killing the process and losing the session's in-process state?
- Does `--conversation` resume cost scale with conversation length? 27s for three turns suggests replay.
- Which directories does `agy` need write access to (`~/.gemini/…`), if containment by sandbox profile is reconsidered?
