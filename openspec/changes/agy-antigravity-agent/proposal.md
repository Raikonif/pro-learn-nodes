## Why

`acp-agent-backend` reaches ChatGPT and Claude subscriptions. It cannot reach a Google one. Google no longer accepts a personal Google sign-in from Gemini CLI — the one Google agent that speaks ACP — and answers `session/new` with *"This client is no longer supported for Gemini Code Assist for individuals… migrate to the Antigravity suite"*. The replacement it names, Antigravity's `agy` CLI, signs in with Google OAuth on its own and works with the learner's account today. It does not speak ACP.

So a Google subscription is reachable only by driving `agy` over its own headless protocol, and doing so safely is the question this change exists to answer.

## Status: deferred

A spike on 2026-09-30 (design.md) found that headless `agy` has **no permission channel**: it writes files and runs commands without asking, `--mode plan` does not stop writes, and `--sandbox` contains the terminal but not its file tool, which wrote outside its working directory. Nothing here could present, refuse, or record a request before the action happened.

That contradicts the rule every other backend is held to — writing, acting outside the node, and executing are asked — and the learner chose to wait rather than contain `agy` by other means. The change is recorded now so the protocol mapping and the safety findings are not rediscovered, and so re-entry is a check rather than a project.

## What Changes (on re-entry)

- A second `Agent` implementation, beside the ACP client: `agy` driven by `--input-format stream-json --output-format stream-json`, one long-lived process per session.
- A registration preset for Antigravity, authenticated through `agy`'s own `/login`. As with ACP agents, no credential is requested, stored, read, or transmitted here — `agy`'s OAuth tokens stay `agy`'s.
- A requirement, added now, that holds every backend to the same line: an agent is offered only if its actions can be asked about before they happen.

## Capabilities

### Modified Capabilities

- `agent-backends`: an agent whose actions cannot be asked about before they happen is not offered as a backend.

## Impact

- **Now**: documentation, the probe script, and one requirement. No code.
- **On re-entry**: `service/agent/agy/` (a stream-json client implementing `Agent`), a preset, and the permission surface of `acp-agent-permissions-and-branching`, which this depends on.
- **Depends on**: `acp-agent-backend`, `acp-agent-permissions-and-branching`.
