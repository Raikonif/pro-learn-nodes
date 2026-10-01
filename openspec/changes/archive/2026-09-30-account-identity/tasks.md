Tasks follow `tdd-workflow-conventions`: the failing test precedes the code that satisfies it, and each group ends green.

## 1. Secret storage and the development gate

- [x] 1.1 Write failing tests for a `SecretStore` contract: store, read, delete, and read-after-delete returning nothing
- [x] 1.2 Add `core/secrets.py` with the `SecretStore` protocol, an in-memory implementation, and a macOS Keychain implementation selected at runtime
- [x] 1.3 Write a failing test asserting `settings.dev_auth_enabled` is `False` when the environment is empty and `True` only from `LEARN_NODES_DEV_AUTH`
- [x] 1.4 Add `dev_auth_enabled` to `core/config.py` with an environment-only validation alias, matching the alias-only treatment `port` already uses
- [x] 1.5 Write a failing test asserting a startup warning is recorded when the flag is enabled, and none when it is not
- [x] 1.6 Emit that warning from application startup

## 2. Profile records and schema

- [x] 2.1 Write failing repository tests: create a profile, read it back by `(provider, subject)`, and assert a second insert with the same pair is rejected
- [x] 2.2 Add `models/profile.py` with `ProfileRecord` (id, provider, subject, email, display_name, avatar_url, created_at) and a unique constraint on `(provider, subject)`
- [x] 2.3 Add `profile_id` as a nullable column on `WorkspaceRecord`
- [x] 2.4 Generate the Alembic migration adding `profiles`, the unique index, and `workspaces.profile_id`
- [x] 2.5 Add `repository/profile_repo.py` covering create, get by identity, get by id, list, and delete (activation is held in `SecretStore`, not in a table, so it belongs to the service layer in 4.4)
- [x] 2.6 Write a failing test that migrating an existing populated database preserves every existing row, then run it against a fixture database

## 3. Identity provider contract and development adapter

- [x] 3.1 Write failing tests for the `Identity` value: a missing or empty subject is rejected
- [x] 3.2 Add `service/identity/protocol.py` defining `Identity` and the provider contract
- [x] 3.3 Write failing tests for the development adapter: it yields a conforming identity with no network access, and yields the same subject for the same requested identity twice
- [x] 3.4 Add `service/identity/dev.py` implementing the contract
- [x] 3.5 Write a failing test asserting the provider registry contains the development adapter only when `dev_auth_enabled` is true

## 4. Profile service

- [x] 4.1 Write failing tests for `enroll`: a new identity creates a profile; the same `(provider, subject)` returns the existing profile without creating a second; changed email or display name updates the existing profile; the same subject from a different provider creates a distinct profile
- [x] 4.2 Implement `service/profile_service.py:enroll`
- [x] 4.3 Write failing tests for activation: enrolling activates; activating replaces a previously active profile; the active profile survives a restart
- [x] 4.4 Implement activation and active-profile resolution, persisting the session through `SecretStore`
- [x] 4.5 Write failing tests for sign-out: the session is cleared, the profile's workspace rows remain, and re-activating requires no provider call
- [x] 4.6 Implement sign-out
- [x] 4.7 Write failing tests for deletion: the named profile's workspace rows are gone, every other profile's rows are untouched, and deletion is refused without the explicit confirmation flag
- [x] 4.8 Implement deletion
- [x] 4.9 Write a failing test that first activation of a profile creates its own empty workspace and default context, leaving any other profile's workspace unchanged
- [x] 4.10 Implement per-profile workspace provisioning, reusing `ensure_default_workspace`

## 5. Request scoping — the breaking change

- [x] 5.1 Write failing tests for the scoping dependency: it resolves the active profile's workspace; it refuses with an authentication-required signal when no profile is active; it refuses immediately after sign-out without any expiry interval
- [x] 5.2 Add `api/dependencies/auth.py` exposing the scoping dependency as the only way to obtain a workspace scope
- [x] 5.3 Write failing route tests asserting a request naming another profile's workspace and a request naming a nonexistent workspace are refused identically
- [x] 5.4 Remove every `workspaceId` parameter from `api/routes/workspace.py` and inject the scope from the dependency instead
- [x] 5.5 Write a failing test that every workspace route refuses while signed out
- [x] 5.6 Confirm `service/workspace.py` and `service/retrieval.py` signatures are unchanged and their existing tests still pass

## 6. Authentication routes

- [x] 6.1 Write failing tests for `POST /auth/dev/signin` returning 404 when `dev_auth_enabled` is false, and enrolling plus activating when it is true
- [x] 6.2 Add `api/routes/auth.py` with development sign-in, registered only when the gate is open
- [x] 6.3 Write failing tests for reading the active profile, signing out, listing enrolled profiles, and deleting a profile
- [x] 6.4 Implement those routes

## 7. Retrieval confinement

- [x] 7.1 Write a failing test that a passage indexed under one profile's source is absent from a search performed under another profile
- [x] 7.2 Write a failing test that the same confinement holds after `rebuild_workspace_index` runs
- [x] 7.3 Make both pass, changing only how the workspace scope reaches retrieval

## 8. Adoption of the existing workspace

- [x] 8.1 Write a failing test that a database holding a workspace with a null `profile_id` gains a `local` profile owning it, with all nodes, links, threads, messages, and anchors intact
- [x] 8.2 Write a failing test that a second startup performs no further adoption and creates no additional profile or workspace
- [x] 8.3 Implement adoption as a data migration that enrols the `local` profile and backfills `workspaces.profile_id`, rather than as runtime code in `initialize_local_data`
- [x] 8.4 Make `workspaces.profile_id` non-nullable in a migration that runs after the backfill

## 9. Frontend account surface

- [x] 9.1 Write failing tests for an account store: signed-out by default, holds the active profile after sign-in, clears on sign-out
- [x] 9.2 Add `features/account/` with the store and its public `index.ts`
- [x] 9.3 Write failing tests for the sign-in surface: it renders when no profile is active, and development sign-in appears only when the backend reports the gate open
- [x] 9.4 Implement the sign-in surface
- [x] 9.5 Write failing tests for the root view gate: signed out renders the sign-in surface and no workspace pane; signing in renders the three-pane workspace
- [x] 9.6 Implement the gate in `app/App.tsx`
- [x] 9.7 Write failing tests for the account affordance: the active display name is visible while a node is open, and signing out returns to the sign-in surface
- [x] 9.8 Implement the account affordance without adding a fourth pane
- [x] 9.9 Write failing tests that hydrated workspace state is discarded when the active profile changes, and that mutations are blocked until the new snapshot is hydrated
- [x] 9.10 Remove `workspaceId` from `shared/lib/workspace-api.ts` request payloads and wire the discard-on-switch behavior

## 10. End-to-end happy path

- [x] 10.1 Add a Playwright fixture that signs in through the development endpoint with the gate enabled
- [x] 10.2 Add an E2E test: launch signed out, sign in, workspace renders, create a node, sign out, sign in as a second account, assert the first account's node is absent, sign back in as the first, assert its node returns

## 11. Documentation

- [x] 11.1 Record in `CLAUDE.md` that workspace routes derive their scope from the active profile and never accept a client-supplied workspace identifier
- [x] 11.2 Document `LEARN_NODES_DEV_AUTH` alongside the existing port overrides, stating that it is for development only
