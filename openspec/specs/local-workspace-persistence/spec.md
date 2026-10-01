# local-workspace-persistence Specification

## Purpose

Provides one durable, local source of truth for a learner's workspace and its conversational learning graph across desktop app restarts.

## Requirements

### Requirement: Workspace state is durably stored on the local device
The system SHALL persist each workspace's nodes, directed node links, threads, messages, selection anchors, and restorable workspace context in local application data. The frontend SHALL NOT be the authoritative durable store for this data.

#### Scenario: Restart preserves a learning graph
- **WHEN** a learner creates or changes workspace graph and conversation data, closes the desktop app, and opens it again
- **THEN** the bootstrap data represents the same persisted nodes, links, threads, messages, and anchors

#### Scenario: UI state is restored independently of graph data
- **WHEN** a learner's last open node or graph viewport has been saved and the app is restarted
- **THEN** the bootstrap data includes that restorable context without changing the graph's node or link relationships

### Requirement: Persisted workspace relationships preserve domain invariants
The system SHALL store nodes, links, threads, messages, and anchors so that each record belongs to exactly one workspace, every node link connects nodes in its workspace, and every thread and message belongs to its owning node. Each node SHALL have exactly one main thread with no selection anchor; a spawned thread SHALL retain its selection anchor, including the source message identifier, offsets, and stored text copy.

#### Scenario: Node creation includes a valid main thread
- **WHEN** a new node is persisted
- **THEN** it is persisted with exactly one unanchored main thread in the same workspace

#### Scenario: Selection branch survives source text changes
- **WHEN** a persisted source message changes after a node link or spawned thread was created from one of its selections
- **THEN** the selection branch retains its stored anchor text and remains available for stale-anchor handling

### Requirement: Related workspace changes are committed consistently
The system SHALL make a multi-record workspace operation visible only after all of its required persisted records and relationships are valid. A failed operation SHALL NOT leave a partial node, link, thread, message, anchor, or workspace-context update visible through bootstrap.

#### Scenario: Failed branch creation leaves no partial graph item
- **WHEN** persisting a branch fails before its required records are complete
- **THEN** a later bootstrap response contains neither a partial branch relationship nor an orphaned branch record

### Requirement: First launch initializes a valid local workspace
The system SHALL initialize local application data on first launch with a valid empty workspace and restorable context for the account being enrolled. Runtime fixtures SHALL NOT be required to make the application bootable. Each account SHALL receive its own workspace and restorable context on first activation, and initializing one account's data SHALL NOT alter another's.

#### Scenario: First launch has no existing data
- **WHEN** the sidecar starts against a new local data location and an account is activated for the first time
- **THEN** bootstrap returns an initialized empty workspace and valid default context for that account

#### Scenario: A second account starts empty
- **WHEN** a second account is activated for the first time on a device that already holds another account's populated workspace
- **THEN** the second account receives its own initialized empty workspace and default context, and the first account's data is unchanged

### Requirement: An existing pre-account workspace is adopted, not orphaned
When local application data contains a workspace that predates account partitioning, the system SHALL attach that workspace to a single account on first launch after upgrade rather than leaving it unreachable or creating a second empty workspace beside it.

#### Scenario: Upgrading with existing local data
- **WHEN** the sidecar starts against local application data holding a workspace created before accounts existed
- **THEN** that workspace is attached to one account, and activating that account presents the same nodes, links, threads, messages, and anchors that were present before the upgrade

#### Scenario: Adoption happens once
- **WHEN** the sidecar starts again after an adoption has already occurred
- **THEN** no further adoption is performed and no additional account or workspace is created
