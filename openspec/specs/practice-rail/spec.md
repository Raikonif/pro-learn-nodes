# practice-rail Specification

## Purpose

The practice tool surface in the lower region of the workspace's right rail: which tools a learner can reach while a node is open, how one is chosen, and what each tool shows when the node carries no practice material, when the tool cannot run, and when no node is open at all.

## Requirements

### Requirement: The practice region renders only while a node is open
When no node is open, the right rail SHALL render no practice tools and no practice content. Opening a node SHALL render the practice region for that node; closing the open node SHALL remove it.

#### Scenario: Idle workspace shows no practice tools
- **WHEN** the workspace is open and no node has been entered
- **THEN** the right rail contains no practice tool surface and no practice content

#### Scenario: Closing the open node removes the practice region
- **WHEN** the learner closes the open node
- **THEN** the practice region is removed from the right rail along with the minimap

### Requirement: A tool with no material for this node says so and offers the way out of it
A node with no practice SHALL be presented by the workbench as having no practice yet, offering the add control, rather than as empty tools. The learner's own questions block and own quiz block SHALL exist only once they hold an item or the learner opens them to author one; opened empty, each SHALL state that it has no questions yet and offer authoring one. The scratch code block SHALL have no empty state: an empty buffer is a usable sandbox and SHALL be presented as one.

#### Scenario: A node with no practice explains itself
- **WHEN** the learner opens a node with no practice items and no scratch code
- **THEN** the workbench states that the node has no practice yet and offers adding some

#### Scenario: Opening one's own quiz with nothing in it
- **WHEN** the learner opens their own quiz block on a node where they have written no quiz questions
- **THEN** the block states that there are no quiz questions yet and offers authoring one

#### Scenario: An empty sandbox is not an empty state
- **WHEN** the learner opens the scratch code block on a node whose scratch buffer is empty
- **THEN** an editable, runnable sandbox is presented rather than a message about missing material

### Requirement: A tool that cannot work names what is unavailable and does not disable its neighbors
When a block cannot function — the code execution runtime cannot be prepared, or the node's practice material cannot be loaded — it SHALL render an unavailable state naming what is unavailable, and SHALL NOT present controls that appear to work and do nothing. The unavailable state SHALL offer retrying, and a successful retry SHALL restore it without reopening the node. A block that cannot work SHALL NOT prevent other blocks, the minimap, or the node's conversation from working. When the node's material cannot be loaded at all, the workbench SHALL say so in place of the block list and offer retrying.

#### Scenario: The execution runtime is unavailable
- **WHEN** the code execution runtime cannot be prepared and the learner expands a code block
- **THEN** the block states that code cannot be run and why, presents no run control that does nothing, and quiz and questions blocks, the minimap, and the conversation remain usable

#### Scenario: Practice material fails to load
- **WHEN** the open node's practice items cannot be loaded
- **THEN** the workbench states that the node's practice material could not be loaded and offers retrying

#### Scenario: Retrying restores the workbench
- **WHEN** the learner retries and the underlying cause has cleared
- **THEN** the workbench lists the node's blocks without the learner reopening the node
