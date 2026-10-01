## Purpose

Establishes a consistent startup contract that lets the desktop frontend hydrate one usable workspace from the local backend without relying on runtime fixtures.

## ADDED Requirements

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

