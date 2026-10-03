## ADDED Requirements

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
