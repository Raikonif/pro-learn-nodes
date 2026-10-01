# selection-branching Specification

## Purpose

Lets a learner branch from a specific passage of a conversation — into either a new session or a side thread — while keeping a durable link back to the text that prompted it.

## Requirements

### Requirement: Selecting message text raises a two-action affordance
Selecting a non-empty range of text within a conversation message SHALL raise an affordance offering exactly two actions: generate a node, and new chat. The affordance SHALL be raised for both learner and agent messages. Clearing the selection SHALL dismiss the affordance without creating anything.

#### Scenario: Selection raises the affordance
- **WHEN** the learner selects a non-empty range of text within a conversation message
- **THEN** an affordance appears offering exactly the two actions "generate a node" and "new chat"

#### Scenario: Clearing the selection dismisses the affordance
- **WHEN** the learner clears an active text selection without choosing an action
- **THEN** the affordance is dismissed and no node and no thread are created

#### Scenario: Selection outside a message raises nothing
- **WHEN** the learner selects text outside any conversation message
- **THEN** no branch affordance appears

### Requirement: Both actions capture a selection anchor
Choosing either action SHALL capture a selection anchor recording the source message identifier, the start and end offsets of the selection within that message, and a copy of the selected text. The copied text SHALL be stored, not derived on read.

#### Scenario: Anchor records offsets and a text copy
- **WHEN** the learner chooses either branch action on a selection
- **THEN** the created branch carries an anchor holding the source message identifier, the selection start and end offsets, and a stored copy of the selected text

### Requirement: Generating a node creates a session visible in the graph
Choosing "generate a node" SHALL create a new node linked to the node the selection came from, carrying the selection anchor. The new node SHALL appear in the graph and in the left rail. The new node SHALL inherit the source node's mode, active skills, and MCP servers unless the learner overrides them at creation.

#### Scenario: Generated node appears in the graph
- **WHEN** the learner chooses "generate a node" on a selection
- **THEN** a new node is created linked to the source node, and it appears in the graph and in the left rail

#### Scenario: Generated node inherits configuration
- **WHEN** a node is generated from a selection without any overrides
- **THEN** the new node's mode, active skills, and MCP servers match the source node's

### Requirement: Starting a new chat creates a thread on the current node
Choosing "new chat" SHALL create a new conversation thread on the node the selection came from, carrying the selection anchor. No new node SHALL be created. The graph and the left rail SHALL be unchanged by this action.

#### Scenario: New chat creates a thread, not a node
- **WHEN** the learner chooses "new chat" on a selection
- **THEN** a new thread is created on the current node, and no new node appears in the graph or the left rail

### Requirement: Anchors resolve against the current message and degrade visibly when they cannot
An anchor SHALL resolve by locating its stored text at its recorded offsets in the source message. When the source message no longer contains the stored text at those offsets, the branch SHALL remain intact and SHALL be presented using the stored text, marked as stale. A branch SHALL NOT be deleted, hidden, or made unreachable because its anchor failed to resolve.

#### Scenario: Anchor resolves against unchanged text
- **WHEN** a branch's anchor is resolved and the source message still contains the stored text at the recorded offsets
- **THEN** the branch is presented against the live message text and is not marked stale

#### Scenario: Rewritten source text leaves the branch reachable
- **WHEN** a correction rewrites the source message so the stored text is no longer at the recorded offsets
- **THEN** the branch remains reachable, is presented using its stored text copy, and is marked stale

#### Scenario: Compacted source text leaves the branch reachable
- **WHEN** compaction collapses the turn containing the source message
- **THEN** the branch remains reachable, is presented using its stored text copy, and is marked stale
