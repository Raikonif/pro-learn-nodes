## Purpose

The practice tool surface in the lower region of the workspace's right rail: which tools a learner can reach while a node is open, how one is chosen, and what each tool shows when the node carries no practice material, when the tool cannot run, and when no node is open at all.

## ADDED Requirements

### Requirement: The practice region presents three peer tools with one selected
While a node is open, the right rail's practice region SHALL present exactly three tools — a questions tool for free-response items, a code sandbox, and a quiz tool for multiple-choice items. Exactly one tool SHALL be selected at any time, and the region SHALL render only the selected tool's content. Every tool SHALL be reachable from every other tool without leaving the node.

#### Scenario: Opening a node selects one tool
- **WHEN** a learner opens a node
- **THEN** the right rail's practice region offers a questions tool, a code sandbox, and a quiz tool, and exactly one of them is selected and rendered

#### Scenario: Selecting another tool replaces only the practice content
- **WHEN** the learner selects a practice tool other than the selected one
- **THEN** the newly selected tool's content is rendered in the practice region, and the minimap, the center region, and the left rail are unchanged

### Requirement: The selected tool is a view preference, not node data
The selected tool SHALL persist when the learner opens a different node, and the newly opened node's material SHALL be shown in that same tool. The selection SHALL NOT be recorded as part of the node's persisted content, and SHALL NOT differ between two learners viewing the same node.

#### Scenario: Switching nodes keeps the tool and changes the material
- **WHEN** the learner has the code sandbox selected and opens a different node
- **THEN** the code sandbox is still the selected tool and it shows the newly opened node's sandbox rather than the previous node's

#### Scenario: Tool selection is absent from node data
- **WHEN** a node's persisted content is read back after the learner switched practice tools
- **THEN** it contains no record of which practice tool was selected

### Requirement: The practice region renders only while a node is open
When no node is open, the right rail SHALL render no practice tools and no practice content. Opening a node SHALL render the practice region for that node; closing the open node SHALL remove it.

#### Scenario: Idle workspace shows no practice tools
- **WHEN** the workspace is open and no node has been entered
- **THEN** the right rail contains no practice tool surface and no practice content

#### Scenario: Closing the open node removes the practice region
- **WHEN** the learner closes the open node
- **THEN** the practice region is removed from the right rail along with the minimap

### Requirement: A tool with no material for this node says so and offers the way out of it
When the open node has no free-response items, the questions tool SHALL state that this node has no questions yet and SHALL offer authoring one. When the open node has no multiple-choice items, the quiz tool SHALL do the same. Neither tool SHALL present an empty list with no explanation. The code sandbox SHALL have no empty state: an empty code buffer is a usable sandbox and SHALL be presented as one.

#### Scenario: A node with no questions explains itself
- **WHEN** the learner selects the questions tool on a node that has no free-response items
- **THEN** the tool states that the node has no questions yet and offers authoring one

#### Scenario: A node with no quiz questions explains itself
- **WHEN** the learner selects the quiz tool on a node that has no multiple-choice items
- **THEN** the tool states that the node has no quiz questions yet and offers authoring one

#### Scenario: An empty sandbox is not an empty state
- **WHEN** the learner selects the code sandbox on a node whose code buffer is empty
- **THEN** an editable, runnable sandbox is presented rather than a message about missing material

### Requirement: A tool that cannot work names what is unavailable and does not disable its neighbors
When a tool cannot function — the code execution runtime cannot be prepared, or the node's practice material cannot be loaded — that tool SHALL render an unavailable state naming what is unavailable, and SHALL NOT present controls that appear to work and do nothing. The unavailable state SHALL offer retrying, and a successful retry SHALL restore the tool without reopening the node. An unavailable tool SHALL NOT prevent the other practice tools, the minimap, or the node's conversation from working.

#### Scenario: The execution runtime is unavailable
- **WHEN** the code execution runtime cannot be prepared for the open node
- **THEN** the code sandbox states that code cannot be run and why, presents no run control that does nothing, and the questions tool, the quiz tool, the minimap, and the conversation remain usable

#### Scenario: Practice material fails to load
- **WHEN** the open node's practice items cannot be loaded
- **THEN** the questions and quiz tools state that the node's practice material could not be loaded and offer retrying

#### Scenario: Retrying restores the tool
- **WHEN** the learner retries from a tool's unavailable state and the underlying cause has cleared
- **THEN** that tool renders its normal content without the learner reopening the node
