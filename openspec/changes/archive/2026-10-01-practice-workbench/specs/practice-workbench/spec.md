## Purpose

The right rail's workbench: one surface that shows the open node's practice as blocks — each a unit of work such as a delivered quiz or one code exercise — appearing when the work exists or is asked for, rather than as fixed tabs that are present whether or not they hold anything.

## ADDED Requirements

### Requirement: The workbench shows the node's practice as blocks
While a node is open, the right rail SHALL present the node's practice as a list of blocks. A block SHALL be one unit of work: the items of one delivery of one kind, one code exercise, the free-response questions the learner wrote, the multiple-choice questions the learner wrote, or the node's scratch code. Each block SHALL show its kind, its title, who authored it, and a status summary of the work in it. Blocks SHALL be listed newest first.

#### Scenario: A node with a delivered quiz and an exercise
- **WHEN** a node holds a quiz an agent delivered and a code exercise
- **THEN** the workbench lists one quiz block holding that delivery's questions and one code block for the exercise, each naming its author

#### Scenario: Two deliveries of the same kind stay apart
- **WHEN** an agent delivers a quiz, and later another quiz, to the same node
- **THEN** the workbench lists two quiz blocks, each holding only its own delivery's questions, including after a restart

#### Scenario: The status summary reflects the attempts
- **WHEN** the learner has answered two of a quiz block's three questions, one correctly
- **THEN** the block's header summarises how many were answered and how many were correct, without the block being expanded

### Requirement: One block is expanded at a time
Exactly one block or none SHALL be expanded. An expanded block SHALL take the workbench's remaining height and render its work; every other block SHALL render as a one-line header. Activating a header SHALL expand that block and collapse the one that was expanded. Collapsing a block SHALL NOT discard unsaved work in it.

#### Scenario: Expanding another block
- **WHEN** a code block is expanded and the learner activates a quiz block's header
- **THEN** the quiz block is expanded, the code block collapses to its header, and the code in it is kept

#### Scenario: Collapsing everything
- **WHEN** the learner collapses the expanded block
- **THEN** every block renders as a header and the minimap is shown in full

### Requirement: Blocks appear when the work exists or is asked for
A node with no practice SHALL show no blocks; the workbench SHALL instead say that the node has no practice yet and offer the add control. The scratch code block SHALL appear once it holds code or the learner opens it.

#### Scenario: An empty node
- **WHEN** the learner opens a node with no practice items and an empty scratch buffer
- **THEN** the workbench lists no blocks, states that the node has no practice yet, and offers adding practice

### Requirement: The add control offers writing practice or asking the agent for it
The workbench SHALL offer an add control listing the kinds of work that can be added. For each kind, it SHALL offer writing it oneself — which opens the matching block ready for authoring — and, where the node runs on an agent, asking the agent for it, which SHALL place the matching command (`/code`, `/qa`, `/quiz`) in the composer without sending it.

#### Scenario: Writing a quiz question oneself
- **WHEN** the learner chooses to write a quiz question from the add control
- **THEN** the learner's own quiz block is expanded with the authoring form open

#### Scenario: Asking the agent for an exercise
- **WHEN** the learner chooses to ask the agent for a code exercise from the add control
- **THEN** the composer holds `/code ` with the cursor after it, and nothing has been sent

#### Scenario: Opening scratch code
- **WHEN** the learner chooses scratch code from the add control
- **THEN** the scratch code block is expanded with an editable, runnable sandbox

### Requirement: A block can be closed without losing anything
The learner SHALL be able to close a block. A closed block SHALL leave the list, and its items, attempts and code SHALL be unchanged. Closed blocks SHALL remain reachable from the workbench and SHALL be reopenable. Practice newly delivered into a closed block's group, or following a conversation record that leads to it, SHALL reopen it.

#### Scenario: Closing a finished quiz
- **WHEN** the learner closes a quiz block
- **THEN** it leaves the list, its questions and attempts are unchanged, and the workbench shows that one block is closed and offers reopening it

#### Scenario: A delivery record reopens a closed block
- **WHEN** the learner activates, in the conversation, the record of a delivery whose block they closed
- **THEN** the block is reopened, expanded, and its items highlighted

### Requirement: The workbench arrangement is a view preference of this device
Which blocks are closed and which is expanded SHALL persist on this device across restarts, per node, and SHALL NOT be recorded in the node's persisted content or sent to the backend. Opening another node SHALL show that node's own arrangement.

#### Scenario: The arrangement survives a restart
- **WHEN** the learner closes a block, expands another, and restarts the application
- **THEN** the same block is closed and the same block is expanded

#### Scenario: The arrangement is absent from node data
- **WHEN** the node's persisted content is read back after the learner rearranged its workbench
- **THEN** it contains no record of which blocks were closed or expanded
