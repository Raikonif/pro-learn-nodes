# workspace-bootstrap Specification

## Purpose

Establishes a consistent startup contract that lets the desktop frontend hydrate one usable workspace from the local backend without relying on runtime fixtures.

## Requirements

### Requirement: Bootstrap returns a self-consistent workspace snapshot
The system SHALL provide a versioned bootstrap response containing one workspace's graph data, conversations, selection anchors, and restorable context from a single consistent persistence revision. The response SHALL identify its schema version and workspace revision.

#### Scenario: Bootstrap loads an existing workspace
- **WHEN** the frontend requests bootstrap for a persisted workspace
- **THEN** it receives all records required to render that workspace without fetching a mixture of earlier and later revisions

#### Scenario: Client detects an incompatible snapshot
- **WHEN** a bootstrap response advertises a schema version unsupported by the frontend
- **THEN** the frontend does not hydrate it as usable workspace state and presents a recoverable startup error

### Requirement: Frontend hydration waits for bootstrap
The frontend SHALL treat the backend bootstrap response as the initial runtime source of workspace state. It SHALL prevent workspace mutations until the current bootstrap response has been validated and hydrated, and SHALL NOT silently substitute fixture data after a bootstrap failure.

#### Scenario: Initial workspace loading
- **WHEN** the application opens while local data initialization and bootstrap succeed
- **THEN** the workspace becomes interactive only after its validated snapshot has been hydrated

#### Scenario: Bootstrap is temporarily unavailable
- **WHEN** the bootstrap request fails or returns invalid data
- **THEN** the workspace presents a retryable startup state and does not display fixture data as the learner's workspace

### Requirement: Restorable workspace context is updated independently
The system SHALL allow the frontend to save and subsequently restore a workspace's last open node and graph viewport without requiring a graph-content update.

#### Scenario: Saving navigation context
- **WHEN** a learner changes the open node or graph viewport
- **THEN** a later successful bootstrap can restore that context while preserving the existing workspace graph and conversations

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
