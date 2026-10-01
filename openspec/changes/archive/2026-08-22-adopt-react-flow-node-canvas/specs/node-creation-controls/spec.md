## Purpose

Lets learners start a new child session from a whole chat node when no particular passage is the reason for branching, while preserving the existing selected-text workflow.

## ADDED Requirements

### Requirement: Node card offers an explicit child-session action
Every node card in the workspace graph SHALL expose an accessible action for creating a child node from the represented node. The action SHALL be visually recognisable as a plus control and SHALL include an accessible name that identifies it as creating a child node.

#### Scenario: Learner finds the child-session action
- **WHEN** a learner views any node card in the graph canvas
- **THEN** the learner can activate a plus control labelled as creating a child node from that card

### Requirement: Whole-node creation creates and opens an unanchored child
Activating a node card's child-session action SHALL create a child node linked to that card's node, create the child's main thread, and open the child in the workspace. The new link SHALL have no selection anchor. The child SHALL inherit the parent node's mode, active skills, and MCP servers.

#### Scenario: Child is created from a node card
- **WHEN** a learner activates the child-session action on a node card
- **THEN** a new node and its main thread are created, the graph contains a link from the selected parent to the new child with no selection anchor, and the child conversation opens

#### Scenario: Child inherits its parent configuration
- **WHEN** a learner creates a child node from a parent with a configured mode, active skills, and MCP servers
- **THEN** the child has the same mode, active skills, and MCP servers

### Requirement: Selected-text branching remains distinct from whole-node creation
The existing selection affordance SHALL continue to offer both node generation and new-chat creation. A node created from selected text SHALL retain its selection anchor, while a node created from a node-card plus control SHALL not have one.

#### Scenario: Selection-created node retains its source passage
- **WHEN** a learner selects text in a conversation and chooses generate node
- **THEN** the resulting graph link stores the selected-text anchor rather than an unanchored whole-node origin
