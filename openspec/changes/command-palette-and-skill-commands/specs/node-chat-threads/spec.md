## MODIFIED Requirements

### Requirement: Threads inherit the node's configuration and cannot override it
A thread SHALL run with the mode, active skills, and MCP servers of the node that owns it. The workspace SHALL NOT present per-thread controls for mode, active skills, or MCP servers. Changing a node's configuration SHALL apply to every thread on that node. A command invoked from a thread's composer that activates or deactivates a skill SHALL change the owning node's configuration and SHALL NOT create a thread-local skill set. A command that runs a skill once from a thread's composer SHALL affect only that single request in that thread and SHALL NOT change any configuration.

#### Scenario: Thread runs with the node's configuration
- **WHEN** a thread is spawned on a node
- **THEN** it runs with that node's mode, active skills, and MCP servers, and the workspace offers no control to change them for that thread alone

#### Scenario: Node configuration change reaches every thread
- **WHEN** the learner changes the mode or active skills of a node holding several threads
- **THEN** every thread on that node runs with the changed configuration

#### Scenario: Activating a skill from a thread changes the node
- **WHEN** the learner activates a skill from a spawned thread's composer
- **THEN** the owning node's active skill set contains that skill and every other thread on that node runs with it

#### Scenario: A one-shot run in a thread leaves configuration untouched
- **WHEN** the learner runs a skill once from a spawned thread's composer
- **THEN** the resulting turn appears in that thread and neither the node's nor any thread's active skill set has changed
