## MODIFIED Requirements

### Requirement: Persisted workspace relationships preserve domain invariants
The system SHALL store nodes, directed node links, threads, messages, anchors, and projects so that each record belongs to exactly one workspace, every node belongs to exactly one project in its own workspace, and every thread and message belongs to its owning node. A node link SHALL connect two nodes of the same workspace and MAY connect nodes whose projects differ; a difference in project SHALL NOT prevent the link from being stored or read back. Each node SHALL have exactly one main thread with no selection anchor; a spawned thread SHALL retain its selection anchor, including the source message identifier, offsets, and stored text copy.

#### Scenario: Node creation includes a valid main thread
- **WHEN** a new node is persisted
- **THEN** it is persisted with exactly one unanchored main thread in the same workspace

#### Scenario: Node creation records exactly one project
- **WHEN** a new node is persisted
- **THEN** it is persisted with exactly one project membership naming a project of the same workspace

#### Scenario: A link across projects is persisted intact
- **WHEN** a node link is persisted between two nodes of one workspace whose projects differ
- **THEN** the link is stored and later read back joining the same two nodes, and neither node's project membership is changed

#### Scenario: Selection branch survives source text changes
- **WHEN** a persisted source message changes after a node link or spawned thread was created from one of its selections
- **THEN** the selection branch retains its stored anchor text and remains available for stale-anchor handling

## ADDED Requirements

### Requirement: Projects and archive state are durably stored with the workspace
The system SHALL persist each workspace's projects, their instructions and source attachments, and the archived state of every project and node in local application data, so that they survive a restart unchanged. The frontend SHALL NOT be the authoritative durable store for project membership or archive state.

#### Scenario: Projects survive a restart
- **WHEN** a learner creates projects, records instructions on one, moves nodes between them, closes the desktop app, and opens it again
- **THEN** the bootstrap data represents the same projects, the same instructions, and the same node memberships

#### Scenario: Archive state survives a restart
- **WHEN** a learner archives a project and a node in a different project, closes the desktop app, and opens it again
- **THEN** both remain archived, including the record of which nodes were archived as a consequence of their project

### Requirement: A workspace always has a default project to receive unassigned nodes
The system SHALL create exactly one default project when a workspace is initialized, and SHALL keep every node's project membership populated at all times. Local application data holding nodes that predate projects SHALL be brought forward by attaching every such node to its workspace's default project rather than leaving its membership absent.

#### Scenario: Initialization creates the default project
- **WHEN** a workspace is initialized in local application data
- **THEN** it contains exactly one default project and no node without a project

#### Scenario: Pre-project nodes are attached, not orphaned
- **WHEN** the sidecar starts against local application data holding nodes created before projects existed
- **THEN** every such node belongs to its workspace's default project and its links, threads, messages, and anchors are unchanged

#### Scenario: Bringing data forward happens once
- **WHEN** the sidecar starts again after nodes have already been attached to the default project
- **THEN** no further attachment is performed and no additional default project is created
