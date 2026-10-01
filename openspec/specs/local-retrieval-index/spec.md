# local-retrieval-index Specification

## Purpose

Creates a private, local retrieval base over learner source content so the application can search useful passages without depending on a hosted vector service.

## Requirements

### Requirement: Indexed source content is represented separately from workspace conversations
The system SHALL persist source content and its metadata separately from workspace nodes, threads, and messages. It SHALL derive immutable, ordered text chunks from source content and retain each chunk's source identity and retrievable location metadata.

#### Scenario: Source content is indexed
- **WHEN** source content is accepted for local indexing
- **THEN** the system records the source and creates ordered chunks that retain enough provenance to identify the originating source passage

### Requirement: Local retrieval returns attributable completed-index results
The system SHALL provide local text retrieval over completed source chunks within the requested workspace. Every result SHALL include its source identity, passage text, and location metadata; chunks that are not yet completely indexed SHALL NOT appear as completed retrieval results.

#### Scenario: Query returns matching passages
- **WHEN** a learner searches for text present in completed indexed source content
- **THEN** the system returns matching passages with their source attribution and location metadata

#### Scenario: Query does not cross workspace boundaries
- **WHEN** two workspaces contain source content with matching text and retrieval is requested for one workspace
- **THEN** results include only chunks belonging to the requested workspace

### Requirement: Indexing status is durable and restart-safe
The system SHALL record indexing progress and failure status durably. After an interrupted shutdown, it SHALL resume or safely restart unfinished work without duplicating completed chunks or exposing a corrupt index.

#### Scenario: Shutdown interrupts indexing
- **WHEN** the application stops while a source is being indexed
- **THEN** the next successful startup identifies that source as unfinished and resumes or restarts its indexing safely

#### Scenario: Indexing failure remains visible
- **WHEN** a source cannot be indexed
- **THEN** its durable status identifies the failure and retrieval continues to return results from other completed sources

### Requirement: Retrieval remains local and independently rebuildable
The system SHALL perform this foundation's retrieval without a required network service, hosted embedding provider, or external vector database. It SHALL permit the local retrieval index to be rebuilt from canonical source content without changing workspace graph or conversation records.

#### Scenario: Rebuilding local retrieval data
- **WHEN** the local retrieval index is rebuilt from existing source content
- **THEN** workspace graph and conversation data remains unchanged and completed source content becomes retrievable again after rebuilding
