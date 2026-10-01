## Purpose

Defines what actually happens when a learner invokes a skill from a command surface — a one-shot run against the open conversation and a separate node-scoped activation toggle — so that reaching for a skill never silently rewrites the session's configuration.

## ADDED Requirements

### Requirement: Running a skill once affects only that request
Invoking a skill's run command SHALL send one request to the provider whose instructions include that skill in addition to whatever the node already had active, and SHALL leave the node's stored active skill set unchanged. The next request in that node SHALL be assembled from the node's stored configuration as though the run had not happened.

#### Scenario: A one-shot run leaves the node's configuration alone
- **WHEN** a learner runs a skill once in a node whose active skill set does not contain it
- **THEN** the response reflects that skill and the node's stored active skill set still does not contain it

#### Scenario: The following turn is unaffected
- **WHEN** the learner sends an ordinary message after a one-shot run
- **THEN** that message is answered with the node's stored active skills only

#### Scenario: Running a skill that is already active
- **WHEN** a learner runs a skill once in a node where that skill is already active
- **THEN** the request carries that skill exactly once and the node's stored active skill set is unchanged

### Requirement: A one-shot run is attributed in the conversation
A one-shot run SHALL appear in the conversation as a turn attributed to the invoked skill rather than as a message the learner appears to have typed. The learner SHALL be able to tell, reading the conversation later, which turn came from which skill.

#### Scenario: The run is identifiable after the fact
- **WHEN** a learner reopens a node in which a skill was run once
- **THEN** the resulting turn is labelled with the skill that produced it

### Requirement: Activation changes the node's stored skill set and takes effect without a restart
Invoking a skill's toggle command while it is inactive SHALL add that skill to the open node's stored active skill set; invoking it while it is active SHALL remove it. The change SHALL apply to the next request in that node with no restart and no reload of the workspace, and SHALL persist across closing and reopening the node and across restarting the application.

#### Scenario: Activation applies to the next message
- **WHEN** a learner activates a skill and then sends a message in the same node
- **THEN** that message is answered with the skill's instructions included, without the application having been restarted

#### Scenario: Activation persists
- **WHEN** a learner activates a skill, closes the node, and reopens it
- **THEN** the skill is still active on that node

#### Scenario: Deactivation applies to the next message
- **WHEN** a learner deactivates an active skill and then sends a message
- **THEN** that message is answered without that skill's instructions

#### Scenario: Toggling does not run the skill
- **WHEN** a learner activates a skill
- **THEN** no request is sent and no turn is added to the conversation

### Requirement: Deactivation does not rewrite what was already said
Removing a skill from a node's active set SHALL NOT alter, hide, or reattribute messages produced while it was active. Prior turns SHALL remain as they were recorded.

#### Scenario: History survives deactivation
- **WHEN** a learner deactivates a skill that produced earlier turns in the node
- **THEN** those turns remain in the conversation unchanged

### Requirement: Skill invocation is scoped to the node, and its run targets the open thread
A skill activation SHALL apply to the node and therefore to every thread on it. A one-shot run SHALL be delivered into the thread the learner had open when the command was invoked, whether that is the node's main thread or a spawned one, and whether the command was invoked from the palette or from that thread's composer.

#### Scenario: Activation reaches every thread
- **WHEN** a learner activates a skill from a spawned thread's composer
- **THEN** the node's stored active skill set contains that skill and every thread on the node runs with it

#### Scenario: A run lands where the learner was
- **WHEN** a learner with a spawned thread open runs a skill once from the palette
- **THEN** the resulting turn is added to that spawned thread and not to the node's main thread

### Requirement: A skill command with no node open is refused without side effects
When no node is open, a skill's run and toggle commands SHALL be unavailable. Invoking one SHALL NOT create a node, SHALL NOT open one, SHALL NOT send a request, and SHALL report that an open node is required.

#### Scenario: No node, no implicit node
- **WHEN** a learner invokes a skill command from the palette while the center region shows the graph
- **THEN** no node is created, no request is sent, and the palette reports that the command requires an open node

#### Scenario: Opening a node makes the same command available
- **WHEN** the learner opens a node and invokes the same command again
- **THEN** the command runs against that node

### Requirement: A one-shot run is refused while the target thread is streaming
While a response is still streaming into the target thread, a one-shot run SHALL be unavailable and SHALL report that reason. An activation toggle SHALL remain available while a response is streaming and SHALL take effect from the following request, leaving the in-flight response untouched.

#### Scenario: A run waits for the stream to finish
- **WHEN** a learner invokes a skill's run command while a response is streaming into the open thread
- **THEN** no second request is sent and the command reports that the thread is busy

#### Scenario: Activation during a stream does not disturb it
- **WHEN** a learner activates a skill while a response is streaming
- **THEN** the streaming response completes unchanged and the following request carries the newly activated skill

### Requirement: A skill that can no longer be read fails the invocation without changing the node
When an invoked skill can no longer be read from the skills directory, the system SHALL refuse the invocation, state that the skill is no longer available, leave the node's stored active skill set unchanged, and add no turn to the conversation.

#### Scenario: A skill removed between listing and invocation
- **WHEN** a learner invokes a skill command whose folder was removed since the catalogue was read
- **THEN** the invocation is refused with a stated reason, the node's active skill set is unchanged, and the conversation gains no turn

#### Scenario: An already-active skill that disappears from disk
- **WHEN** a node has a skill active whose folder is no longer readable and the learner sends a message
- **THEN** the message is answered without that skill and the workspace states that the skill could not be loaded
