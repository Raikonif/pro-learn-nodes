## Purpose

Practice questions attached to a node and the record of every answer given to them — how a learner authors a free-response or multiple-choice question, how answering it produces an append-only attempt, and how that material relates to node branching and to the session graph.

## ADDED Requirements

### Requirement: A learner can author a free-response question on the open node
The system SHALL let a learner create a free-response practice item on the open node from a non-empty prompt, optionally carrying a reference answer. The created item SHALL belong to exactly one node and SHALL appear in that node's questions tool without reopening the node. A creation attempt with an empty prompt SHALL be refused with the reason stated, and SHALL create nothing.

#### Scenario: A free-response question is created and appears
- **WHEN** the learner authors a free-response item with a non-empty prompt on the open node
- **THEN** the item is created against that node and appears in the node's questions tool without the node being reopened

#### Scenario: An empty prompt is refused
- **WHEN** the learner attempts to author a free-response item with an empty prompt
- **THEN** the attempt is refused with the reason stated and no item is created

### Requirement: A learner can author a multiple-choice question on the open node
The system SHALL let a learner create a multiple-choice practice item on the open node from a non-empty prompt, at least two options, and exactly one option designated correct. A creation attempt with fewer than two options, with no designated correct option, or with more than one designated correct option SHALL be refused with the reason stated, and SHALL create nothing. The created item SHALL appear in that node's quiz tool without reopening the node.

#### Scenario: A multiple-choice question is created and appears
- **WHEN** the learner authors a multiple-choice item with a prompt, three options, and one of them designated correct
- **THEN** the item is created against the open node and appears in the node's quiz tool

#### Scenario: Fewer than two options is refused
- **WHEN** the learner attempts to author a multiple-choice item with one option
- **THEN** the attempt is refused with the reason stated and no item is created

#### Scenario: No designated correct option is refused
- **WHEN** the learner attempts to author a multiple-choice item whose options include none designated correct
- **THEN** the attempt is refused with the reason stated and no item is created

### Requirement: Submitting an answer records an attempt
Submitting an answer to a practice item SHALL record an attempt identifying the item, the node the item belongs to, the submitted response, and the time of submission. An attempt on a multiple-choice item SHALL additionally record which option was chosen and whether it matched the item's designated correct option. An attempt on a free-response item SHALL be recorded without a score, because nothing in this capability evaluates free text.

#### Scenario: A free-response submission is recorded ungraded
- **WHEN** the learner submits a free-response answer
- **THEN** an attempt is recorded holding the item, the node, the submitted text, and the submission time, and carrying no score

#### Scenario: A multiple-choice submission records the choice and its correctness
- **WHEN** the learner submits a multiple-choice answer
- **THEN** an attempt is recorded holding the chosen option and whether it matched the item's designated correct option

### Requirement: Submitting shows what was recorded, and does not imply a grade it did not compute
After a multiple-choice submission, the system SHALL show whether the chosen option matched the designated correct option and which option was designated correct. After a free-response submission, the system SHALL show the recorded answer and, when the item carries a reference answer, SHALL reveal it presented as a reference for the learner to compare against. The system SHALL NOT present a score, a mark, or a pass or fail judgement for a free-response answer.

#### Scenario: A wrong multiple-choice answer is shown as such
- **WHEN** the learner submits a multiple-choice answer that is not the designated correct option
- **THEN** the submission is shown as not matching, and the designated correct option is shown

#### Scenario: A reference answer is revealed only after submitting
- **WHEN** the learner submits an answer to a free-response item that carries a reference answer
- **THEN** the reference answer is revealed as a reference, and no score or pass-or-fail judgement is shown for the submitted answer

#### Scenario: An item with no reference answer reveals nothing
- **WHEN** the learner submits an answer to a free-response item that carries no reference answer
- **THEN** the recorded answer is shown and no reference answer is presented

### Requirement: Answering again adds an attempt and never rewrites one
An item that already has one or more attempts SHALL remain answerable. A further submission SHALL create an additional attempt and SHALL NOT modify, replace, or delete any earlier attempt. Attempts SHALL NOT be editable after submission. The tool SHALL present the most recent attempt for an item and SHALL make visible that earlier attempts exist, including how many.

#### Scenario: A second answer creates a second record
- **WHEN** the learner answers an item, then answers it again with different content
- **THEN** two attempts exist for that item, the first holding its original content unchanged and the second holding the new content

#### Scenario: The latest attempt is shown with the earlier ones acknowledged
- **WHEN** an item has more than one attempt
- **THEN** the tool presents the most recent attempt and shows how many attempts have been made on that item

#### Scenario: A submitted attempt cannot be edited in place
- **WHEN** the learner revises an answer after submitting it
- **THEN** the revision is recorded as a new attempt and the previously submitted attempt is unchanged

### Requirement: Practice material belongs to its node and is not inherited by a branch
Practice items, attempts, and the node's sandbox code SHALL belong to the node they were created on. Creating a child node by branching SHALL NOT copy, link, or otherwise carry any of them into the child: the child SHALL start with no practice items, no attempts, and an empty sandbox. The source node's items, attempts, and sandbox code SHALL be unchanged by the branch and SHALL remain available on the source node.

#### Scenario: A branched child starts with no practice material
- **WHEN** the learner branches a new node from a node that has practice items, attempts, and sandbox code
- **THEN** the child node has no practice items, no attempts, and an empty sandbox buffer

#### Scenario: Branching leaves the source node's material intact
- **WHEN** a child node has been branched from a node carrying practice material
- **THEN** the source node still shows the same items, the same attempts, and the same sandbox code as before the branch

### Requirement: Items and attempts are durable and confined to their node
Practice items and attempts SHALL be persisted outside the frontend and SHALL be restored when the application is restarted. Retrieving a node's practice material SHALL return the items and attempts belonging to that node and SHALL NOT return any belonging to another node.

#### Scenario: Items and attempts survive a restart
- **WHEN** the learner authors an item, answers it, and the application is closed and reopened
- **THEN** reopening that node shows the item and its recorded attempt

#### Scenario: One node's material does not appear on another
- **WHEN** two nodes each carry their own practice items and attempts
- **THEN** each node's practice tools show only that node's items and attempts

### Requirement: Practice material is not a member of the session graph
A practice item and a recorded attempt SHALL NOT appear as a node in the session graph, in the right-rail minimap, or in the left rail's node index. Authoring an item or recording an attempt SHALL NOT create a node, a link between nodes, or a conversation thread.

#### Scenario: Authoring an item does not change the graph
- **WHEN** the learner authors a practice item on the open node
- **THEN** the session graph, the minimap, and the left-rail node index contain the same nodes and links as before

#### Scenario: Answering does not change the graph
- **WHEN** the learner submits an answer and an attempt is recorded
- **THEN** no new node, node link, or conversation thread is created
