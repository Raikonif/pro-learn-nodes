# node-agent-sessions Specification

## Purpose

Keeps the graph the application's own — persistent, branchable, and durable — while the conversation itself runs inside an agent-owned session that is ephemeral and linear, by defining exactly what survives the gap between the two.

## Requirements


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

### Requirement: A session keeps each agent's own session, and returning to an agent continues it
The system SHALL keep, for each thread, the agent session of every agent that has run it. When a thread's node returns to an agent that already has a session for that thread, the system SHALL continue that agent's session and SHALL give it the messages recorded since that agent last took part — and only those — rather than the whole conversation. The conversation SHALL NOT show a continuity break when this succeeds.

Where the agent's session cannot be continued, the system SHALL fall back to establishing the conversation from the recorded transcript, and SHALL show the break, as `node-agent-sessions` already requires.

#### Scenario: Switching away and back
- **WHEN** a session runs a turn on one agent, then a turn on a second agent, then returns to the first
- **THEN** the first agent's own session is continued, it is given the second agent's exchange as what it missed, and no continuity break is shown

#### Scenario: An agent that missed nothing is given nothing extra
- **WHEN** a session sends consecutive turns to the same agent
- **THEN** each turn carries only the learner's new message

#### Scenario: Removing an agent keeps the session readable and runnable
- **WHEN** an agent that ran a session is removed and the session continues on another agent
- **THEN** every recorded message remains, and the conversation continues on the other agent

### Requirement: Branching carries the parent's conversation up to the branch point
When a node is created by branching from a selected passage, the first turn of its conversation SHALL give the agent the parent's conversation up to and including the message the passage was selected from, and nothing recorded after it, and SHALL identify the selected passage as the reason for the branch. When a node is created as a child of a whole node, its first turn SHALL give the agent the parent's conversation as it stood when the child was created. The inherited conversation SHALL be given once, when the child's agent session is first opened, not on every turn.

The child's recorded conversation SHALL begin empty, and messages sent in the child SHALL NOT appear in the parent.

#### Scenario: Branching from a passage
- **WHEN** a learner branches from a selected passage partway through a parent conversation and sends a first message in the child
- **THEN** the agent receives the parent's conversation up to that message, with the passage identified as the reason, and nothing after the branch point

#### Scenario: A whole-node child inherits the parent as it was
- **WHEN** a learner creates a child of a node, the parent's conversation continues afterwards, and the learner then writes in the child
- **THEN** the child's agent receives the parent's conversation as it stood when the child was created, without the later messages

#### Scenario: The child's record starts empty
- **WHEN** a child node created by branching is opened
- **THEN** its conversation shows no messages, and messages subsequently sent in it do not appear in the parent

#### Scenario: Inheritance is given once
- **WHEN** the learner sends several messages in a branched child on the same agent
- **THEN** only the first carries the parent's conversation

### Requirement: A thread spawned from a passage carries its node's conversation up to that passage
When a side thread is started from a passage of a node's main thread, the first turn of that thread SHALL give the agent the main thread's conversation up to and including the message the passage was selected from, with the passage identified as the reason.

#### Scenario: A side thread knows what it was spawned from
- **WHEN** a learner starts a new chat from a passage and sends a first message in it
- **THEN** the agent receives the main thread up to that passage, with the passage identified

### Requirement: A branch shows where it came from
A node or thread created from another conversation SHALL show, at the start of its conversation, which conversation it came from and the passage it was created from, if any, and SHALL let the learner return to that passage.

#### Scenario: Returning to the origin
- **WHEN** the learner activates the origin shown at the top of a branched node
- **THEN** the parent node opens with the passage in view

### Requirement: Inherited context is bounded and says when it was cut
When a parent's conversation up to the branch point exceeds a fixed budget, the inherited context SHALL keep the most recent messages that fit, SHALL always include the branch message and the passage, and SHALL state that earlier messages were left out.

#### Scenario: Branching from a long conversation
- **WHEN** a learner branches from late in a conversation longer than the budget
- **THEN** the child's agent receives the most recent messages up to the branch point, the passage, and a statement that earlier messages were omitted

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
