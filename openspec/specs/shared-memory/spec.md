# shared-memory Specification

## Purpose

Lets what a learner comes to know persist beyond the session where it came up, and be available to every agent they use — with the learner, not any agent, deciding what is remembered.

## Requirements

### Requirement: An agent may propose a memory, and a proposal is not yet a memory
Any agent SHALL be able to propose a short fact about what the learner knows or has worked on. A proposal SHALL record its text, the agent that proposed it, and the session it came from. A proposal SHALL NOT be returned to any agent as memory until the learner accepts it.

#### Scenario: A proposal awaits the learner
- **WHEN** an agent proposes a memory
- **THEN** the learner can see it as pending, with its source session and agent, and no agent receives it when reading memory

### Requirement: The learner decides every proposal
The learner SHALL be able to accept a proposal, accept it with edited text, or reject it. A rejected proposal SHALL NOT become memory. An accepted memory SHALL be editable and removable by the learner at any time.

#### Scenario: Accepting with an edit
- **WHEN** the learner edits a proposal's text and accepts it
- **THEN** the edited text is what agents receive

#### Scenario: Rejecting
- **WHEN** the learner rejects a proposal
- **THEN** it is never returned to any agent as memory

#### Scenario: Removing an accepted memory
- **WHEN** the learner removes an accepted memory
- **THEN** no agent receives it afterwards

### Requirement: Accepted memory is shared across agents and sessions
Accepted memories SHALL be readable by every agent in every session of the account that accepted them, regardless of which agent or session proposed them, and SHALL NOT be readable from any other account.

#### Scenario: One agent's proposal reaches another agent
- **WHEN** a memory proposed by one agent in one session has been accepted, and a different agent in a different session reads memory
- **THEN** that memory is returned

#### Scenario: Memory stays within the account
- **WHEN** an agent working for another account reads memory
- **THEN** none of this account's memories are returned

### Requirement: Memory can be exported
The learner SHALL be able to export accepted memories as Markdown.

#### Scenario: Exporting memory
- **WHEN** the learner exports memory
- **THEN** a Markdown document listing every accepted memory, with its source session, is produced

### Requirement: A memory may have a topic, and a proposal on a known topic is a revision
A memory MAY carry a topic — a short stable key naming what it is about. When an agent proposes a fact under a topic that an accepted memory already has, the proposal SHALL be presented to the learner as a revision of that memory, showing the accepted text beside the proposed one. Accepting a revision SHALL make the revised text the memory agents receive, and SHALL keep the previous text as that memory's history rather than discarding it. Rejecting it SHALL leave the accepted memory unchanged.

#### Scenario: A proposal on an existing topic is shown as a revision
- **WHEN** an agent proposes a fact under a topic that an accepted memory already has
- **THEN** the learner sees it as a revision, with the current accepted text and the proposed text side by side

#### Scenario: Accepting a revision keeps the history
- **WHEN** the learner accepts a revision
- **THEN** agents receive the revised text, and the earlier text remains visible in that memory's history

#### Scenario: Rejecting a revision changes nothing
- **WHEN** the learner rejects a revision
- **THEN** agents keep receiving the memory's current accepted text
