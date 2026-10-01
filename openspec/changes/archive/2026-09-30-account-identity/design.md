## Context

See `proposal.md - Why` for motivation. The relevant current state:

- Every table in `models/workspace.py` already carries `workspace_id`, and every service lookup in `service/workspace.py` (`_node`, `_thread`, `_anchor`) fetches by primary key and then rejects rows whose `workspace_id` does not match the caller's. The schema is already multi-tenant with one tenant.
- `api/routes/workspace.py` takes `workspaceId` from the request body or query on every route and passes it straight through. Nothing verifies the caller is entitled to that workspace, because until now there was no caller identity.
- `core/database.py:configure_database(data_dir)` builds the engine at startup rather than import, and `core/runtime.py:initialize_local_data(data_dir)` composes configure → migrate → ensure workspace → validate against an arbitrary directory.
- `service/retrieval.py` maintains a `source_chunk_fts` FTS5 projection that already carries `workspace_id` and filters on it, and exposes `rebuild_workspace_index()` as its rebuild seam.
- The backend has no secret storage of any kind today.

Constraints: the app must remain usable offline and with no external identity provider configured; the design must not foreclose moving the database to a hosted server later; CI runs on Linux, where the macOS Keychain does not exist.

## Goals / Non-Goals

**Goals**

- One tenancy model that survives a move from local SQLite to a hosted database without redesign.
- Exactly one place where the request's data scope is decided, so it can be tested once.
- Sign-in mechanisms that are addable without touching account handling, storage, or routes.
- A complete, shippable account system with zero externally-registered credentials.

**Non-Goals**

- Protecting one account's data from another human with filesystem access to the device. Local data is readable by anyone who can read the file, and the system keychain is scoped to the operating-system user, not to the signed-in account. This is a partition, not a security boundary. See *Risks*.
- Any authorization model: no roles, permissions, or privilege levels.
- Google, GitHub, or any network-backed sign-in (follow-up change `oauth-identity-providers`).
- AI provider credentials (follow-up change `provider-credentials`).
- Synchronizing an account's data between devices.

## Decisions

### One database with a tenancy column, not a database per account

`WorkspaceRecord` gains `profile_id`; a new `profiles` table sits above it. No other table changes, because `workspace_id` is already the tenancy column on all nine.

*Alternative considered — a separate SQLite file per account* (`profiles/<id>/workspace.sqlite3`), which `configure_database` already supports since it disposes and rebuilds the engine when the path changes. It makes cross-account leakage physically inexpressible and reduces account deletion to removing a directory.

Rejected because it is the option that a future hosted database cannot adopt. Merging N single-tenant files into one multi-tenant schema means adding a tenancy column to every table and backfilling it — precisely the work this design avoids by keeping the column that already exists. The leak risk that motivated the per-file option is materially lower than it first appears given the existing ownership checks, and the scoping dependency below narrows it further.

### The data scope is a request dependency, never a request parameter

Routes lose their `workspaceId` parameters. A FastAPI dependency in `api/dependencies/auth.py` resolves active session → profile → workspace and injects the resulting scope. Services keep their present signatures, so `service/workspace.py` and `service/retrieval.py` need no change: they still receive a `workspace_id`, it simply no longer originates with the client.

This is the single most valuable part of the change, and the reason to do it while the app is still single-user. Today a client-supplied `workspaceId` is harmless. The moment two accounts share a database it is an insecure direct object reference, and retrofitting the check across every route after the fact is how one route gets missed.

Concentrating it in a dependency means the entitlement check exists in exactly one function with exactly one test, rather than being a convention every future route must remember.

*Alternative considered* — keep accepting `workspaceId` and validate ownership inside each service function. Rejected: it distributes a security check across a growing surface and makes "did we cover every route" an ongoing audit rather than a settled fact.

### Sessions are local records, and sign-in is enrollment rather than a gate on every launch

Which account is active is held by `SecretStore` under a single key whose value is a profile id. Signing in writes it; signing out deletes it; startup reads it. Nothing contacts a provider on launch.

It lives in the secret store rather than in a table for three reasons: sign-out must be able to destroy it outright, the macOS Keychain scopes it to the operating-system user rather than to the data file, and `core/migrations.py:backup_database` copies the database on every migration — so a session held in a table would be duplicated into every backup and would travel with a database copied to another machine. The profiles themselves are ordinary rows; only the pointer to the active one is held outside the database.

This is what makes the app work offline and what makes returning to a previously enrolled account instant. It also means the eventual OAuth adapters run exactly once per account rather than on every start, which keeps them at the edge of the system instead of on the startup path.

### Identity is `(provider, subject)`, with display fields deliberately mutable

A unique constraint on `(provider, subject)` makes enrollment idempotent at the database level rather than by convention. `email`, `display_name`, and `avatar_url` are all refreshed on every sign-in and none participates in identity, because email addresses are reassigned and changed while OIDC subjects are not.

### The development adapter is the first implementation of the real contract, not a stub around it

`service/identity/protocol.py` defines the provider contract; `service/identity/dev.py` implements it. Google and GitHub adapters will be additional files implementing the same protocol, with no change to `profile_service`, the routes, or the schema.

Consequences worth naming: the account system is fully buildable and testable now with no external console access; the Playwright suite drives development sign-in directly, which permanently solves the fact that browser automation cannot pass a hosted consent screen; and the follow-up OAuth change arrives with a working reference implementation and a passing suite to conform to.

### The development adapter is gated by environment only, and the closed gate returns 404

`settings.dev_auth_enabled` defaults to `False` with an environment-only validation alias, matching how `core/config.py` already treats `port` — alias-only, no `populate_by_name` — so the field name is not a binding key and nothing that names the setting the way the code does can turn it on. The alias narrows the *key* but not the *source*: `model_config` sets `env_file=".env"`, and pydantic-settings resolves dotenv entries through the same aliases, so a `.env` carried inside a bundle would otherwise open the gate. A validator re-reads `os.environ` so that whatever source proposed `True`, it stands only if the process was launched with the variable set. The adapter is registered only when the flag is true, and the route returns 404 rather than 403 when it is not, so a distributed build does not advertise that the endpoint exists.

The test that the endpoint returns 404 with the flag off is the one that keeps the gate closed in released builds; a suite that only exercises the enabled path passes with the gate deleted.

### Secrets go behind a protocol because CI has no Keychain

`core/secrets.py` defines a `SecretStore` protocol with a macOS Keychain implementation and an in-memory implementation for tests. This is not speculative abstraction: GitHub Actions runs Linux, where the `security` CLI does not exist, so without it the backend suite cannot run in CI at all. It follows the precedent set by `configure_database` taking a `data_dir` rather than reading a global.

For this change the stored secret is only the local session marker. The same store is what `provider-credentials` will use for the per-account data key that encrypts AI provider keys.

### Sign-out preserves data; deletion is a separate, confirmed action

Sign-out clears the session and nothing else, so signing back in is instant and offline. Destroying an account's data is a distinct action with a confirmation that names the consequence. Conflating the two is how a learner loses a graph by clicking the wrong item in a menu.

### The authentication route contract

Fixed here so the frontend and the backend can be built against it independently:

| Route | Behavior |
|---|---|
| `GET /auth/session` | `{profile, devSignInAvailable}` — `profile` is `null` when signed out. Never 401: this is the route that *reports* signed-out state, so failing it would leave the frontend unable to render the sign-in surface. |
| `POST /auth/dev/signin` | Body `{displayName?, email?}`. Enrolls and activates, returns the profile. **404 when the gate is closed**, so a distributed build does not advertise the endpoint. |
| `POST /auth/signout` | Clears the active session. Idempotent — signing out while already signed out succeeds. The body is unspecified; the client accepts either JSON or an empty 204, so the route may return whichever is natural. |
| `GET /auth/profiles` | Every enrolled profile, oldest first. |
| `DELETE /auth/profiles/{id}` | Requires an explicit confirmation flag; destroys that profile and its workspace data. |

`devSignInAvailable` is reported by the server rather than inferred by the client, because the gate is a server-side setting and the frontend has no other way to know whether offering the control would lead anywhere.

Every *workspace* route requires an active account and refuses without one (see `profile-scoped-data-access`). These `/auth/*` routes are the exception: they must be reachable while signed out or there would be no way to sign in.

## Risks / Trade-offs

- **The partition is not a security boundary, and could be mistaken for one.** Local data is a readable file, and the macOS Keychain is scoped to the operating-system user, so one OS user's accounts can all be read by the app without re-authenticating. → Stated explicitly in *Non-Goals* and in the `account-profiles` purpose so a later feature does not assume isolation the system does not provide. Instant account switching is a deliberate consequence of this, not an oversight.

- **A route added later could reintroduce a client-supplied scope.** The dependency only protects routes that use it. → The scoping dependency is the only exported way to obtain a workspace scope, and the delta spec states the refusal behavior as a contract, so a route that bypasses it fails a spec-derived test rather than merely differing from convention.

- **Adoption of the existing pre-account workspace runs once against real learner data.** A defect here loses the current graph. → `core/migrations.py:backup_database` already takes a timestamped copy before every migration, so the pre-adoption state is recoverable. Adoption is idempotent and asserted so by test.

- **A development build could be distributed with the gate open.** → Environment-only configuration, off by default, a startup warning when enabled, a 404 when disabled, and a test asserting the 404.

- **FTS5 and the SQLite-specific partial unique index on `chat_threads` remain in the way of a hosted database.** This change does not remove them. → It also does not add to them. The retrieval projection is already rebuildable behind `rebuild_workspace_index()`, which is the seam a different backend would replace; the tenancy column this change relies on is the portable part.

## Migration Plan

1. One Alembic migration adds `profiles`, a unique index on `(provider, subject)`, and `workspaces.profile_id` as nullable. The active-session pointer needs no migration; it lives in `SecretStore`.
2. A **data migration** enrols the `local` profile and backfills every null `profile_id` to it.

   Adoption belongs in the migration chain rather than in `initialize_local_data`, and the ordering forces it: `migrate_database` runs *before* any runtime adoption could, so a runtime backfill would be attempted only after a later non-nullable migration had already failed on the rows it was meant to fix. Alembic's version table also makes "adoption happens once" a property of the mechanism instead of an idempotence check that has to be written and tested.
3. A following migration makes `workspaces.profile_id` non-nullable. Keeping it a separate revision means a defect in the backfill is correctable by editing one migration and re-running, without a schema rollback.
4. Rollback: `backup_database` has already written a timestamped copy under `backups/`; restoring it returns the database to its pre-adoption state. The two-step nullable→non-nullable sequence means a rollback between them requires no data change.

## Open Questions

- Whether the account affordance belongs in the left rail or in a window-level chrome region. It affects no contract in the specs — `node-workspace-layout` requires only that it be visible and not occupy a fourth pane — and can be settled while building.
- Whether a future hosted deployment scopes rows by `profile_id` directly on every table for database-level row policies, rather than through the single `workspace → profile` hop. That is a denormalization decided by the hosting model, addable by migration, and it changes nothing here.
