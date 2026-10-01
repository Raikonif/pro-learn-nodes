## MODIFIED Requirements

### Requirement: Threads inherit the node's configuration and cannot override it
A thread SHALL run with the mode, active skills, MCP servers, and conversation backend of the node that owns it. The workspace SHALL NOT present per-thread controls for mode, active skills, MCP servers, or the conversation backend. Changing a node's configuration SHALL apply to every thread on that node.

#### Scenario: Thread runs with the node's configuration
- **WHEN** a thread is spawned on a node
- **THEN** it runs with that node's mode, active skills, MCP servers, and conversation backend, and the workspace offers no control to change them for that thread alone

#### Scenario: Node configuration change reaches every thread
- **WHEN** the learner changes the mode or active skills of a node holding several threads
- **THEN** every thread on that node runs with the changed configuration

#### Scenario: Changing the backend reaches every thread
- **WHEN** the learner changes the conversation backend of a node holding several threads
- **THEN** every thread on that node runs on the changed backend, and no thread continues on the previous one
