## Why

The application cannot be entered. `available_providers()` registers a sign-in mechanism only when `LEARN_NODES_DEV_AUTH` is exported, so `GET /auth/session` answers `{"profile": null, "devSignInAvailable": false}` on any ordinary launch, `App.tsx` renders the sign-in surface because no profile is active, and that surface has nothing to offer but the sentence "No sign-in method is available." The documented dev loop in `CLAUDE.md` produces this state, and so would a distributed build: the Google and GitHub adapters that were meant to be the real doors were deferred to `oauth-identity-providers`, which has not been written.

The gate itself is correct and stays. What is wrong is that a gate held shut by default is the only door. A second problem compounds it: `scripts/dev.mjs` discovers the backend but never starts one, so forgetting the first terminal yields a window stuck on "Loading your workspace…" rather than an error naming the cause.

## What Changes

- Add a **local identity provider** that enrolls an account from a name the learner types, with no external service, no browser, and no network. It is registered unconditionally — no gate — and is therefore the mechanism that guarantees a freshly installed app is always enterable.
- The sign-in surface becomes a **profile chooser**: enrolled accounts on this device are listed and selectable, with a "create a profile" affordance beside them. Development sign-in remains an additional option when its gate is open, rather than the surface itself.
- Add `pnpm run all:dev`, a single command that starts the backend, **waits for it to answer `/health`**, and only then starts the Tauri and Vite side. The wait is required, not cosmetic: `dev.mjs` resolves the backend by reading `.dev-ports.json` and verifying the health payload, so an unsequenced start races into the unverified branch it exists to avoid.
- A failure to start either process reports which one failed and stops, instead of leaving a half-running stack and a window that reports only that the workspace will not load.
- No change to enrollment, activation, scoping, sign-out, or deletion. A local identity is an ordinary `Identity` and reaches the account system through the contract that already exists.

## Capabilities

### New Capabilities

- `unified-dev-launch`: one command that brings up the whole development stack in a health-gated order, and reports which process failed when one does.

### Modified Capabilities

- `identity-providers`: adds a local sign-in mechanism that is always available and never gated, so at least one door exists in every build; clarifies that the development gate governs the development adapter alone and not the availability of sign-in as such.
- `account-profiles`: an account may be created with a learner-supplied display name, and the enrolled accounts on a device are selectable at sign-in rather than only after one is already active.

## Impact

- **Backend**: new `service/identity/local.py`; `service/identity/__init__.py` registers it unconditionally. `api/routes/auth.py` gains a local sign-in route that is always present, and `SessionOut` reports the available mechanisms rather than only whether development sign-in is available. No migration: `ProfileRecord` already stores `provider` and `subject`, and `provider="local"` is already the value the adoption migration writes.
- **Frontend**: `features/account/components/SignInSurface.tsx` becomes a chooser over `GET /auth/profiles` plus a create form; `account-api.ts` gains the local sign-in call and a widened session schema.
- **Scripts**: new `scripts/dev-all.mjs`; `package.json` gains `all:dev`. `scripts/dev-ports.mjs` gains a reusable "wait until healthy" helper — `discoverBackendPort` already verifies `/health` once, and the launcher needs the same check with a retry budget.
- **Docs**: `CLAUDE.md` and the README lead with `pnpm run all:dev`; the two-terminal loop stays documented for working on one side alone.
- **Not in scope**: the Google and GitHub adapters. This change makes them optional rather than urgent — they become a way to carry an identity between machines, not the precondition for using the app at all.
