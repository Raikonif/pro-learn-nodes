## MODIFIED Requirements

### Requirement: Generating a node creates a session visible in the graph
Choosing "generate a node" SHALL create a new node linked to the node the selection came from, carrying the selection anchor. The new node SHALL appear in the graph and in the left rail. The new node SHALL inherit the source node's project, mode, active skills, and MCP servers unless the learner overrides them at creation. When the learner overrides the project with a different one, the link back to the source node SHALL still be created and SHALL cross the two projects rather than being refused.

#### Scenario: Generated node appears in the graph
- **WHEN** the learner chooses "generate a node" on a selection
- **THEN** a new node is created linked to the source node, and it appears in the graph and in the left rail

#### Scenario: Generated node inherits configuration
- **WHEN** a node is generated from a selection without any overrides
- **THEN** the new node's project, mode, active skills, and MCP servers match the source node's

#### Scenario: Overriding the project still links back to the source
- **WHEN** the learner generates a node from a selection and names a project other than the source node's
- **THEN** the new node belongs to the named project and the link to the source node exists and crosses the two projects

## ADDED Requirements

### Requirement: Branching from an archived node is refused until it is restored
Selecting text within a conversation of an archived node SHALL NOT create a new node or a new thread. The system SHALL indicate that the node must be restored first and SHALL leave the archived node unchanged.

#### Scenario: Generate a node from an archived conversation
- **WHEN** the learner selects text in a conversation of an archived node and chooses "generate a node"
- **THEN** no node is created, the archived node is unchanged, and the system indicates it must be restored first

#### Scenario: New chat from an archived conversation
- **WHEN** the learner selects text in a conversation of an archived node and chooses "new chat"
- **THEN** no thread is created and the system indicates the node must be restored first
