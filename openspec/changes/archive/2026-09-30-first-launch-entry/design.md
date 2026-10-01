## Context

`account-identity` built the account system against a single adapter — the development sign-in — and deferred Google and GitHub to `oauth-identity-providers`. That follow-up has not been written, and the development adapter is registered only when `LEARN_NODES_DEV_AUTH` is present in the process environment. The two facts together mean `available_providers()` returns an empty dict on an ordinary launch, which is verifiable today:

```
GET /health        200  {"status":"ok","backend":"fastapi"}
GET /auth/session  200  {"profile":null,"devSignInAvailable":false}
```

`App.tsx` renders `SignInSurface` because no profile is active; `SignInSurface` renders "No sign-in method is available" because none is. There is no next step from that screen. The gate is behaving exactly as designed — the defect is that it is the only door.

The second half of this change is smaller and has the same shape: `scripts/dev.mjs` is written to *connect* to a backend, never to start one, so the documented loop requires two terminals and forgetting one produces a window that reports only that the workspace will not load.

## Goals / Non-Goals

**Goals**

- A freshly built application is enterable with no environment variable, no network, and no external service.
- Accounts already on the device are reachable from the signed-out state.
- One command brings up the development stack, in an order that satisfies the dependency between its processes.
- No change to enrollment, activation, scoping, sign-out, or deletion.

**Non-Goals**

- Google and GitHub adapters. This change makes them optional rather than urgent.
- Making the account partition a security boundary. It is not one now and is not one after this; see `tech-stack.md`, which states the partition separates work rather than people with disk access.
- Password, passphrase, or any local secret protecting a profile. Adding one would imply a guarantee the on-disk data cannot keep.
- Supervising the production sidecar. `all:dev` is a development command; the Tauri sidecar lifecycle is unchanged.

## Decisions

### A new `local` adapter, rather than ungating the development one

Ungating `dev` would be one line and is the wrong line. The development adapter exists to be *absent* from a distributed build — that absence is what makes `POST /auth/dev/signin` answer 404 rather than advertise an endpoint enrolling accounts without credentials, and it is what the startup warning in `local_data_lifespan` is warning about. Removing the gate would make the warning meaningless and delete the property the gate was built to hold.

The two mechanisms also differ in what they are for. `dev` is a test seam: it must produce the *same* account from the same request so the Playwright suite signs in repeatedly without accumulating accounts. `local` is a product surface: creating a profile is a deliberate act, and two learners who both type "Alice" must get two graphs.

### The local subject is random, and deliberately not derived from the name

`_subject_for` in the development adapter hashes the email or display name so the subject is stable across restarts. The local adapter does the opposite and generates a fresh opaque subject per enrollment.

The reasoning inverts because the return path does. A development sign-in gets you back to your account by *re-deriving* the subject, so determinism is load-bearing. A local sign-in gets you back by *selecting your account from the picker*, so determinism buys nothing — and costs two things. Deriving from the display name would make renaming yourself indistinguishable from being someone else, which the development adapter's own docstring already identifies as the reason it prefers email as a seed. And it would collapse two learners named "Alice" into one graph, silently.

`uq_profile_identity` enforces `(provider, subject)`, so a random subject is exactly the "these are different accounts" statement we want to make.

### `provider = "local"` is already the right value, not a collision

`migrations/versions/20260825_01_adopt_existing_workspace.py` already writes `provider="local"` with `subject="adopted-workspace"` when it adopts a pre-account workspace. That is not a conflict to work around — it is the outcome this change wants. The adopted account *is* a local account: it belongs to whoever runs this install, was created without an external service, and is identified by a name rather than by a provider's subject. Once the picker exists, it appears there and is selectable like any other, with no adoption-specific handling anywhere.

Random subjects cannot collide with the fixed `"adopted-workspace"`, so the uniqueness constraint is satisfied without a special case. The migration's `downgrade` deletes only that exact pair, so profiles created by this adapter are untouched by a rollback.

### The session report names mechanisms instead of answering one yes/no question

`SessionOut.devSignInAvailable` answers a question about one adapter. With two adapters and more coming, the client would accumulate a boolean per mechanism, and each new adapter would be a wire change on both sides.

The field is replaced by a list of the mechanisms this process offers. That is the same shape `available_providers()` already returns, so the route reports what the registry knows rather than re-deriving it — which is the property the registry was introduced to hold, per `service/identity/__init__.py`. The frontend's Zod schema changes with it; both halves ship together, so no compatibility window is needed.

**BREAKING** on the wire, and only on the wire: no stored data and no behavior of enrollment or scoping changes.

### The picker lists accounts, including ones this process could not have created

`GET /auth/profiles` already exists and is already reachable while signed out — `account-identity` built it for exactly this and noted that "an account picker that required an account would have nothing to offer the learner who has just signed out of the only one." This change is the first consumer.

An account enrolled through a mechanism the running process does not offer must still be listed and selectable. Its data is on disk and activation reads a stored row; nothing about reaching it depends on the adapter that first created it. Filtering the list by registered adapters would strand a developer's `dev` accounts the moment they launched without the gate — the same class of dead end this change exists to remove.

### The launcher waits on a verified health response, not on a delay or an open socket

`dev.mjs` resolves the backend with `discoverBackendPort()`, which reads `.dev-ports.json` and then verifies the `/health` payload before trusting the port. That verification is the whole design of `dev-port-allocation`: an open socket is indistinguishable from a stranger holding the port, so the payload is what proves the port belongs to *this* backend.

Starting the two processes concurrently races that check. The launcher would look before the backend answers, fall into the unverified branch, and print a warning that reads as advisory while producing a window whose only symptom is "Loading your workspace…". So `all:dev` polls `/health` with a retry budget and starts the Tauri side only once it answers, reusing the same verification `discoverBackendPort` performs rather than a second, weaker one.

### The launcher stays in the parent's process group

`backend.mjs` documents why the process tree is kept flat: `uv run uvicorn` inserts a process that does not reliably pass a kill down to the server, and orphaned backends then hold ports that later allocations skip past because they only *look* taken. It also rejects detaching into a separate process group, because surviving a group-wide kill is how the leak was observed.

`all:dev` adds a third process above those two and must not reintroduce either failure. It spawns both children in its own group, forwards `SIGINT`/`SIGTERM` to both, and stops the backend if the frontend exits or fails to start — including when the health wait times out, which is the new way this command can leave something running.

## Risks / Trade-offs

- **A build could ship with local sign-in and no protection at all.** That is already true of the data: the SQLite file is readable by the OS user, and `tech-stack.md` states the partition is not a security boundary. Local sign-in makes the existing property visible rather than changing it. It would be a real risk if the app ever became multi-user or hosted, at which point local sign-in must be gated the way `dev` is — noted here so the future decision is not made by accident.
- **Replacing `devSignInAvailable` breaks any out-of-tree client.** There are none; the frontend is the only consumer and ships together with the backend.
- **The health wait adds startup latency to `all:dev`.** Bounded by the backend's own start time, which the developer would otherwise spend waiting in the second terminal.
- **A bounded wait can time out on a slow machine while the backend is merely late.** Mitigated by making the timeout generous and by reporting the elapsed wait and the backend's output on failure, so the developer can tell "not running" from "still starting".

## Migration Plan

No schema change and no data migration. `ProfileRecord` already stores `provider` and `subject`, and `provider="local"` already appears in the database of any install that went through adoption.

Existing installs:

- An install with an adopted workspace gains a selectable account in the picker; its graph is unchanged.
- An install whose only accounts are `dev` accounts keeps them, and they remain listed and selectable whether or not the gate is open on the next launch.
- A fresh install sees an empty picker and a create form.

The two-terminal commands remain, so any developer muscle memory or external script continues to work.

## Open Questions

- **Should `account-identity` be archived before this change is applied?** It is complete at 58/58 but unarchived, so `identity-providers` and `account-profiles` exist only as deltas inside it and not yet in `openspec/specs/`. This change's deltas are `ADDED`-only and therefore do not depend on the base spec's text, but archiving in the wrong order would produce two changes creating the same main spec. Archiving `account-identity` first is the clean sequence.
- **Should renaming a profile be part of this change or a follow-up?** The spec requires the display name to be editable without affecting identity. The route does not exist yet, and the sign-in surface is not obviously where it belongs — the account affordance in the workspace header is the more natural home.
- **Does `all:dev` belong in `package.json` alone, or should `pnpm dev` become the combined command?** Making `dev` combined is friendlier and is what a newcomer will type; keeping them separate preserves a documented behavior that scripts and habits may depend on.
