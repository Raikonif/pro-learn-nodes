Tasks follow `tdd-workflow-conventions`: the failing test precedes the code that satisfies it, and each group ends green.

## 1. The local identity adapter

- [x] 1.1 Write a failing test asserting the local adapter yields a conforming `Identity` with `provider="local"` and a non-empty subject, with the network, `subprocess`, and the filesystem nailed shut for the duration — mirroring how `tests/test_identity_dev.py` asserts the property structurally rather than believing it
- [x] 1.2 Write a failing test asserting two enrollments with the *same* display name yield two *different* subjects, and that neither subject contains or is derived from the name
- [x] 1.3 Write a failing test asserting an enrollment with no display name still yields a valid identity
- [x] 1.4 Add `service/identity/local.py` with `LOCAL_PROVIDER_NAME = "local"` and an adapter generating an opaque random subject per call
- [x] 1.5 Write a failing test asserting a generated subject never equals the migration's `"adopted-workspace"` sentinel, and that enrolling a local profile alongside an adopted one leaves both rows intact
- [x] 1.6 Write a failing test asserting `available_providers()` contains the local adapter with the development gate both open and shut
- [x] 1.7 Register the local adapter unconditionally in `service/identity/__init__.py`, leaving the development adapter's gate untouched

## 2. The auth surface reports mechanisms

- [x] 2.1 Write a failing test asserting `GET /auth/session` reports the registered mechanisms as a list, and that reading it neither enrolls nor activates anything
- [x] 2.2 Write a failing test asserting the reported list contains the development mechanism only when its gate is open, and always contains the local one
- [x] 2.3 Replace `SessionOut.devSignInAvailable` with the mechanism list, sourced from `available_providers()` rather than re-read from settings
- [x] 2.4 Write a failing test asserting `POST /auth/local/signin` enrolls and activates, and is present with the development gate shut
- [x] 2.5 Add the local sign-in route to `create_router()`, registered from the registry like the development route so the gate stays consulted in exactly one place
- [x] 2.6 Write a failing test asserting `GET /auth/profiles` lists a profile whose provider is not registered in the running process
- [x] 2.7 Confirm — or fix — that profile listing and activation are independent of which adapters are registered
- [x] 2.8 Write a failing test asserting `POST /auth/profiles/{id}/activate` opens an enrolled account without enrolling a second, with the development gate shut, and answers 404 for an unknown id
- [x] 2.9 Add the activation route — required by the picker, reaching no adapter, so returning to an account works offline and for a mechanism this process no longer offers

## 3. The sign-in surface becomes a chooser

- [x] 3.1 Write a failing test asserting `SignInSurface` renders the enrolled accounts returned by the profiles endpoint, each selectable
- [x] 3.2 Write a failing test asserting selecting an enrolled account activates it and does not create a second
- [x] 3.3 Write a failing test asserting a device with no enrolled accounts renders the create form and no empty-picker error state
- [x] 3.4 Write a failing test asserting an account whose provider is absent from the session report is still rendered and still selectable
- [x] 3.5 Widen the Zod schemas in `features/account/account-api.ts` for the mechanism list, and add the local sign-in and activation calls
- [x] 3.6 Rebuild `SignInSurface` as picker-plus-create, keeping development sign-in as an additional option when the session report names it
- [x] 3.7 Write a failing test asserting a failed local sign-in leaves the surface usable and shows a recoverable error
- [x] 3.8 Assert the dead end is gone: with no environment variables set, the surface offers a completable action rather than "No sign-in method is available"

## 4. The combined launcher

- [x] 4.1 Write a failing test for a `waitForHealthy` helper in `scripts/dev-ports.mjs`: it resolves once the health payload identifies this backend, rejects on a bounded timeout, and is not satisfied by an unrelated process holding the port
- [x] 4.2 Add `waitForHealthy`, reusing the payload verification `discoverBackendPort` already performs rather than adding a second, weaker check
- [x] 4.3 Write a failing test asserting the launcher starts the Tauri side only after the health wait resolves
- [x] 4.4 Write a failing test asserting a backend that never becomes healthy causes a non-zero exit, a message naming the backend, and no started Tauri process
- [x] 4.5 Write a failing test asserting every started child is stopped when the launcher exits, including on `SIGINT` and on the health-wait timeout
- [x] 4.6 Add `scripts/dev-all.mjs` spawning `backend.mjs`, waiting, then spawning `dev.mjs` — children in the launcher's own process group, per the flat-tree reasoning in `backend.mjs`
- [x] 4.7 Add `all:dev` to `package.json`
- [x] 4.8 Write a failing test asserting startup reports each process's address and states when a default was unavailable

## 5. End to end

- [x] 5.1 Write a failing Playwright spec: create a profile by name and land in the workspace. **Partial:** the spec runs against the suite's shared backend, which `playwright.config.ts` starts with the gate *open* (the config's other specs need the development adapter's repeatable subject). Launching a second, gate-shut backend would need a second Playwright config; the gate-shut path is instead covered by `test_local_sign_in_is_present_while_the_development_gate_is_shut` (backend) and `offers no development sign-in when the gate is closed` (frontend).
- [x] 5.2 Write a failing Playwright spec: create two profiles with the same display name, confirm two distinct graphs and that both are individually selectable
- [x] 5.3 Write a failing Playwright spec: sign out, select the earlier profile from the picker, confirm its graph returns
- [x] 5.4 Confirm the existing E2E sign-in path still uses the development endpoint and still passes with the gate open

## 6. Documentation

- [x] 6.1 Update `CLAUDE.md` to lead with `pnpm run all:dev`, keeping the two-terminal loop documented for single-side work
- [x] 6.2 Update the `LEARN_NODES_DEV_AUTH` section: it is how Playwright signs in, no longer the only way to enter the app
- [x] 6.3 Note in `openspec/roadmap.md` that Phase 3a's sign-in no longer depends on `oauth-identity-providers` to be usable
- [x] 6.4 Run the full suite — `uv run pytest`, `pnpm test`, `pnpm run typecheck`, `pnpm exec playwright test` — and confirm green
