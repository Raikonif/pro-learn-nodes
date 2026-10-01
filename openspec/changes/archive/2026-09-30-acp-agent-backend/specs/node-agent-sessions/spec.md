## Purpose

Keeps the graph the application's own — persistent, branchable, and durable — while the conversation itself runs inside an agent-owned session that is ephemeral and linear, by defining exactly what survives the gap between the two.

## ADDED Requirements

### Requirement: The recorded conversation is the application's, not the agent's
The system SHALL record every message of a conversation in its own storage as it occurs, and SHALL treat that record as authoritative. Reading a past conversation SHALL NOT require an agent to be installed, configured, running, or reachable.

#### Scenario: Reading a conversation with no agent available
- **WHEN** a learner opens a node whose backend agent is not installed on this device
- **THEN** the full conversation renders from the application's own record, and only the ability to send a new message is unavailable

#### Scenario: Removing an agent does not remove history
- **WHEN** a learner removes a configured agent
- **THEN** every conversation that ran on it remains readable in full

### Requirement: A conversation continues across an application restart
The system SHALL let a learner continue a node's conversation after the application has been restarted, without recreating the node or the thread, and without the learner being asked how continuity should be achieved.

Where continuity cannot be fully preserved — because the agent cannot resume a prior session and the conversation must be re-established from the recorded transcript — the system SHALL make that visible in the conversation rather than presenting it as unbroken.

#### Scenario: Resuming after a restart
- **WHEN** a learner restarts the application and sends a further message in a node that already holds a conversation
- **THEN** the turn proceeds with the prior conversation as context, and no node or thread is recreated

#### Scenario: An agent that cannot resume
- **WHEN** the backend agent cannot resume a prior session
- **THEN** the conversation is re-established from the recorded transcript, the turn proceeds, and the conversation shows where the agent's continuity was broken

### Requirement: A node's conversation is isolated from every other node's
The system SHALL ensure that a node's conversation state is not reachable from another node, and that material from one node is never carried into another's context except through the inheritance a branch defines.

#### Scenario: Two nodes on the same agent stay separate
- **WHEN** two nodes run concurrently on the same configured agent
- **THEN** neither node's conversation appears in the other, and neither node's context includes the other's messages

