## Why

The application has no concept of a person: `WorkspaceRecord` is effectively a singleton and every route accepts a client-supplied `workspaceId` that is trusted without checking who is asking. A learner cannot keep separate accounts on one machine, and the same trusted-identifier pattern becomes an authorization defect the moment more than one account's data lives in the same database — including any future hosted deployment.

This change introduces enrolled accounts, an active-account concept, and server-side scoping of every workspace request, while keeping the app usable with no external identity service configured.

## What Changes

- Add a `Profile` record identifying an enrolled account by the stable pair `(provider, subject)`, with `email` and `display_name` kept as non-identifying display fields.
- Partition workspace data by profile: `WorkspaceRecord` gains a `profile_id`. Every existing table already carries `workspace_id`, so no other table changes.
- Add a pluggable identity-provider contract with one adapter in this change: a **development sign-in** that mints a profile without any browser, network call, or external console configuration. Google and GitHub adapters are a separate follow-up change and require no schema or route changes.
- **BREAKING**: workspace routes stop accepting `workspaceId` from the client. The active profile's workspace is resolved server-side and injected. Requests that name a workspace the active profile does not own are rejected as not found.
- **BREAKING**: the workspace is no longer the unconditional root view. The window opens on a sign-in surface when no profile is active, and on the workspace once one is.
- Add sign-out, which clears the stored session and returns to the sign-in surface while leaving that profile's data on disk so signing back in is immediate and offline.
- Add explicit, separately-confirmed deletion of a profile and its data. Sign-out never deletes.
- Adopt the existing on-disk workspace into a `local` profile on first launch after upgrade, so no learner loses their current graph.
- Gate the development sign-in behind an environment-only setting that is off by default; the route is absent, not merely refused, when the gate is closed.

## Capabilities

### New Capabilities

- `account-profiles`: Enrolled accounts on one device — enrollment, the single active account, sign-out, switching back to a previously enrolled account, and explicit data deletion.
- `identity-providers`: The contract every sign-in mechanism satisfies, and the development sign-in adapter together with the gate that keeps it out of normal runs.
- `profile-scoped-data-access`: Server-side derivation of the data scope for every workspace request, replacing client-supplied workspace identifiers.

### Modified Capabilities

- `node-workspace-layout`: the workspace is the root view only when a profile is active; otherwise the window opens on the sign-in surface.
- `local-workspace-persistence`: first launch initializes data for a profile, and an existing pre-profile workspace is adopted rather than orphaned.
- `workspace-bootstrap`: the bootstrap snapshot is selected by the active profile rather than by a requested workspace identifier.

## Impact

- **Backend**: new `models/profile.py`, `repository/profile_repo.py`, `service/profile_service.py`, `service/identity/` (protocol + development adapter), `api/routes/auth.py`, `api/dependencies/auth.py`, `core/secrets.py`. `api/routes/workspace.py` loses its `workspaceId` parameters. One Alembic migration adds `profiles` and `workspaces.profile_id`.
- **Frontend**: new `features/account/` with the sign-in surface and the account affordance; `app/App.tsx` gains the gate; `shared/lib/workspace-api.ts` stops sending `workspaceId`.
- **Secrets**: session tokens are held by an abstracted secret store, so the suite runs on Linux CI where the macOS Keychain does not exist.
- **Deferred to follow-up changes**: Google and GitHub adapters (`oauth-identity-providers`), and AI provider API keys (`provider-credentials`). Neither is required for this change to ship.
