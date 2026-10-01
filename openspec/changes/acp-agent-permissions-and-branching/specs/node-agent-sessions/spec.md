## ADDED Requirements

### Requirement: Branching carries the parent's conversation up to the branch point
When a node is created by branching, the system SHALL establish the child's conversation with the parent's conversation up to the branch point as context, and no further. Where the branch was made from a selected passage, that passage SHALL be identified to the agent as the reason for the branch.

The child's recorded conversation SHALL begin empty, and messages sent in the child SHALL NOT appear in the parent.

#### Scenario: Branching from a passage
- **WHEN** a learner branches from a selected passage partway through a parent conversation
- **THEN** the child's first turn has the parent's conversation up to that point as context, the selected passage is identified as the reason, and nothing after the branch point is included

#### Scenario: The child's record starts empty
- **WHEN** a child node created by branching is opened
- **THEN** its conversation shows no messages, and messages subsequently sent in it do not appear in the parent

### Requirement: A node's working directory bounds what an agent can reach
The system SHALL give each node a directory that is the working directory of any agent running that node's conversation, and SHALL place that node's attached files within it. An agent SHALL NOT be given a working directory that contains another node's material, the application's own data store, or an arbitrary location on the device.

#### Scenario: The agent reaches this node's attachment
- **WHEN** a learner attaches a file to a node and the agent reads a file in its working directory
- **THEN** the attachment is present and readable there

#### Scenario: The agent does not reach another node's material
- **WHEN** an agent running one node's conversation enumerates its working directory
- **THEN** no other node's material and no part of the application's data store is present

#### Scenario: Deleting a node removes its directory
- **WHEN** a node is deleted
- **THEN** its directory and the attachments within it are removed with it
