## ADDED Requirements

### Requirement: Bootstrap resolves its workspace from the active account
The system SHALL select the workspace returned by bootstrap from the active account rather than from a workspace identifier supplied by the caller. A bootstrap request SHALL NOT need to name a workspace, and naming one SHALL NOT change which workspace is returned.

#### Scenario: Bootstrap without a workspace identifier
- **WHEN** the frontend requests bootstrap while an account is active and supplies no workspace identifier
- **THEN** it receives that account's workspace snapshot

#### Scenario: Bootstrap while signed out
- **WHEN** bootstrap is requested while no account is active
- **THEN** no workspace snapshot is returned and the frontend presents the sign-in surface rather than a retryable startup error

### Requirement: Switching accounts replaces hydrated workspace state
The frontend SHALL discard hydrated workspace state when the active account changes and SHALL hydrate from a bootstrap response belonging to the newly active account before permitting workspace mutations.

#### Scenario: Signing in as a different account
- **WHEN** a learner signs out and signs in as a different account
- **THEN** the previous account's nodes and conversations are absent from the hydrated state, and the workspace becomes interactive only after the new account's snapshot has been validated and hydrated
