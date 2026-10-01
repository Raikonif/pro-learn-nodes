# conversation-streaming Specification

## Purpose

Renders a turn as it arrives rather than on completion, so a learner watching an agent think can read, interrupt, and correct it — and so a long turn is legible progress rather than an unexplained wait.

## Requirements

### Requirement: A turn renders incrementally as it arrives
The system SHALL deliver a turn's content to the workspace as it is produced and SHALL render it as it is delivered. A turn SHALL NOT be withheld until it is complete.

An agent's intermediate activity — the tools it invokes and the plan it reports — SHALL be shown as it occurs, distinguishable from the answer itself.

#### Scenario: Text appears before the turn ends
- **WHEN** an agent produces a turn over several seconds
- **THEN** its content appears in the conversation as it is produced, before the turn has ended

#### Scenario: Tool activity is visible and distinguishable
- **WHEN** an agent invokes a tool during a turn
- **THEN** the invocation is shown in the conversation, distinguishable from the agent's answer

### Requirement: A turn in progress can be cancelled
The system SHALL let a learner cancel a turn that is in progress, SHALL instruct the agent to stop, and SHALL retain the content already received as an explicitly incomplete turn.

#### Scenario: Cancelling keeps what arrived
- **WHEN** a learner cancels a turn after partial content has arrived
- **THEN** the agent is instructed to stop, the partial content remains in the conversation, and it is marked incomplete rather than presented as an answer

#### Scenario: The node is usable immediately after cancelling
- **WHEN** a learner cancels a turn
- **THEN** a new message can be sent without waiting for the cancelled turn to finish or reloading the node

### Requirement: A turn ends with a stated outcome
The system SHALL record how each turn ended — completed, cancelled, refused, or failed — and SHALL make that visible in the conversation. A turn that ended without an answer SHALL NOT be indistinguishable from one that completed.

#### Scenario: A failed turn is distinguishable from a short one
- **WHEN** a turn ends in failure after producing some content
- **THEN** the conversation shows that it failed and why, rather than presenting the partial content as a completed answer

### Requirement: A dropped connection does not lose recorded content
The system SHALL record a turn's content as it arrives rather than only on completion, so that content already received survives the loss of the connection carrying it. On reopening the node, the conversation SHALL show what was recorded and the state the turn ended in.

#### Scenario: The workspace disconnects mid-turn
- **WHEN** the connection carrying a turn is lost after partial content has arrived
- **THEN** reopening the node shows the content that was recorded, marked incomplete

#### Scenario: Closing a node does not silently discard a turn
- **WHEN** a learner closes a node while a turn is in progress and reopens it later
- **THEN** the conversation shows the turn's recorded content and the state it ended in
