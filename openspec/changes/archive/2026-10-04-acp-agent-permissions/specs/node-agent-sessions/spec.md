## ADDED Requirements

### Requirement: A node's working directory bounds what an agent can reach
The system SHALL give each node a directory that is the working directory of any agent running that node's conversation. The directory SHALL hold only that node's material, such as the practice the learner is working on in it. An agent SHALL NOT be given a working directory that contains another node's material, the application's own data store, or an arbitrary location on the device.

#### Scenario: The agent reaches this node's practice
- **WHEN** a learner is working on an exercise in a node and the agent lists its working directory
- **THEN** the exercise and the learner's current solution are present and readable there

#### Scenario: The agent does not reach another node's material
- **WHEN** an agent running one node's conversation enumerates its working directory
- **THEN** no other node's material and no part of the application's data store is present

#### Scenario: Archiving keeps the directory
- **WHEN** a node is archived and later restored
- **THEN** its directory holds the same material it held before it was archived

#### Scenario: Deleting an account removes its nodes' directories
- **WHEN** an account is deleted
- **THEN** the directory of every node it owned is removed, and nothing outside those directories is removed, including anything a link inside one of them points to
