## Purpose

Makes an agent's request to act a decision the learner sees and answers, so that an agent asking permission advances the conversation instead of silently stalling it, and so that routine reading inside a node does not require an answer every time.

## ADDED Requirements

### Requirement: A permission request reaches the learner and blocks the turn until answered
The system SHALL present every permission request an agent makes that is not covered by an automatic decision, SHALL identify what is being requested and what it would affect, and SHALL hold the turn until the learner answers or cancels.

A request the learner cannot see SHALL NOT be silently refused or silently granted.

#### Scenario: An agent asks before acting
- **WHEN** an agent requests permission for an action not covered by an automatic decision
- **THEN** the workspace presents the request with the action and its target, and the turn does not proceed until the learner answers

#### Scenario: Refusing continues the conversation
- **WHEN** the learner refuses a permission request
- **THEN** the refusal is delivered to the agent, the turn continues, and the refusal is visible in the conversation record

#### Scenario: A request arriving while the node is closed is not lost
- **WHEN** a permission request arrives for a node the learner is not currently viewing
- **THEN** the request is surfaced where the learner can find it, and the turn is not failed merely because the node was not on screen

### Requirement: Reading within the node's own directory is decided automatically
The system SHALL grant, without asking, an agent's request to read within the working directory of the node whose conversation it is running. Every other request — writing, acting outside that directory, and executing anything — SHALL be asked.

#### Scenario: Reading an attachment needs no answer
- **WHEN** an agent reads a file inside its node's working directory
- **THEN** the read proceeds without a prompt

#### Scenario: Writing is asked even inside the node's directory
- **WHEN** an agent requests to write inside its node's working directory
- **THEN** the learner is asked

#### Scenario: Execution is always asked
- **WHEN** an agent requests to run a command
- **THEN** the learner is asked, regardless of where it would run

### Requirement: A remembered decision is scoped and revocable
Where the system offers to remember a decision so the same request is not asked again, it SHALL record the scope the learner chose, SHALL apply it no more broadly than that, and SHALL provide a way to review and revoke remembered decisions.

A remembered decision SHALL NOT be carried to a different agent, and SHALL NOT be carried to another account.

#### Scenario: A remembered decision is not applied more broadly
- **WHEN** a learner remembers a decision for one node
- **THEN** the same request in another node is asked again

#### Scenario: Remembered decisions are reviewable and revocable
- **WHEN** a learner reviews remembered permission decisions
- **THEN** each is listed with its scope and can be revoked, after which the corresponding request is asked again

#### Scenario: A remembered decision does not cross accounts
- **WHEN** a different account becomes active
- **THEN** no permission decision remembered by another account is in effect
