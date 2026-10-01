## Purpose

Lets a project carry instructions and attached sources that apply to every node inside it, layered over the account-wide equivalents, so a line of study can be given standing guidance once instead of node by node.

## ADDED Requirements

### Requirement: A project carries instructions that apply to the nodes it holds
The system SHALL let a learner record instructions on a project. Those instructions SHALL be included in the assembled context of every conversation in every node whose project membership is that project, and SHALL NOT be included for a node belonging to any other project. Clearing a project's instructions SHALL remove them from subsequent assembled context without affecting the account-wide instructions.

#### Scenario: Project instructions reach a member node
- **WHEN** a learner records instructions on a project and opens a conversation in a node belonging to that project
- **THEN** the assembled context for that conversation includes the project's instructions

#### Scenario: Project instructions do not reach a non-member node
- **WHEN** a conversation is opened in a node belonging to a different project
- **THEN** the assembled context does not include the first project's instructions

#### Scenario: Cleared instructions stop applying
- **WHEN** a learner clears a project's instructions
- **THEN** later conversations in that project's nodes are assembled without them, and the account-wide instructions still apply

### Requirement: A project carries attached sources that apply to the nodes it holds
The system SHALL let a learner attach sources to a project. Those sources SHALL be available as grounding material to every node whose project membership is that project, in addition to any source attached to the node itself and to any source attached account-wide. Detaching a source from a project SHALL stop it applying to that project's nodes and SHALL NOT delete the source or affect any other scope it is attached to.

#### Scenario: Project sources ground a member node
- **WHEN** a learner attaches a source to a project and opens a conversation in a node belonging to it
- **THEN** that source is available as grounding material for the conversation

#### Scenario: Detaching leaves the source intact
- **WHEN** a learner detaches a source from a project
- **THEN** the source no longer grounds that project's nodes, still exists in the workspace, and still applies to any other scope it is attached to

### Requirement: The nearest scope governs where instructions conflict
The system SHALL assemble instructions from every applicable scope, ordered from the widest scope to the nearest. Where two scopes give conflicting instructions, the nearest scope SHALL govern: a project's instructions take precedence over the account-wide instructions, and a node's own instructions take precedence over its project's. A nearer scope SHALL NOT suppress a wider scope's non-conflicting instructions.

#### Scenario: Project instruction overrides the account-wide one
- **WHEN** the account-wide instructions and a project's instructions give conflicting guidance and a conversation is opened in a node of that project
- **THEN** the assembled context presents the project's instruction as governing

#### Scenario: Non-conflicting wider guidance is retained
- **WHEN** a project records instructions that do not conflict with the account-wide instructions
- **THEN** the assembled context contains both

#### Scenario: A node's own instructions govern over its project's
- **WHEN** a node records instructions conflicting with its project's instructions
- **THEN** the assembled context presents the node's instruction as governing

### Requirement: Attached sources accumulate across scopes rather than overriding
The system SHALL make the sources of every applicable scope available together, because a source is material rather than a directive and a nearer scope has no basis for withdrawing material a wider one supplied. A source attached at more than one applicable scope SHALL be made available once, not once per scope.

#### Scenario: Account-wide and project sources are both available
- **WHEN** a source is attached account-wide, another is attached to a project, and a conversation is opened in a node of that project
- **THEN** both sources are available as grounding material

#### Scenario: A source attached at two scopes appears once
- **WHEN** the same source is attached both account-wide and to the project of the node being opened
- **THEN** it is made available to the conversation exactly once

### Requirement: Membership decides which project's context applies, not reachability
The system SHALL determine the project context of a node from that node's own project membership. Following a link from a node in one project to a node in another SHALL NOT cause the linking project's instructions or sources to apply to the node reached. A node linked to parents in several projects SHALL be governed only by the instructions and sources of the single project it belongs to.

#### Scenario: Crossing a link does not carry context across
- **WHEN** a learner follows a link from a node in one project into a node belonging to another project and opens a conversation there
- **THEN** the assembled context includes the second project's instructions and sources and not the first project's

#### Scenario: A shared child follows its own membership
- **WHEN** a node is linked as a child of parents in two different projects and a conversation is opened in it
- **THEN** the assembled context is governed by the project the child itself belongs to, regardless of which parent it was reached from

### Requirement: A learner can see which instructions and sources govern an open node
The system SHALL let a learner inspect, for the open node, which instructions and sources are being applied and which scope each came from. The inspection SHALL name the account-wide, project, and node scopes distinctly, and SHALL indicate where a nearer scope has overridden a wider one.

#### Scenario: Applied context is attributable to its scope
- **WHEN** a learner inspects the applied context of an open node
- **THEN** each applied instruction and source is shown with the scope it came from

#### Scenario: An override is visible as an override
- **WHEN** a project instruction has overridden a conflicting account-wide instruction for the open node
- **THEN** the inspection indicates that the account-wide instruction was overridden and by which scope
