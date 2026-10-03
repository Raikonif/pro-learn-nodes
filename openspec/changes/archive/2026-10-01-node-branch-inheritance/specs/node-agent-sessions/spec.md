## ADDED Requirements

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
