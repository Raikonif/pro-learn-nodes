## ADDED Requirements

### Requirement: Graph and minimap use a consistent node-card representation
The center graph and right-rail minimap SHALL represent the same workspace nodes and parent-child links. The center graph SHALL use chat-like node cards, and the minimap SHALL visibly distinguish the open node while preserving direct navigation to another node.

#### Scenario: Canvas and minimap agree on graph contents
- **WHEN** a learner opens a node in a workspace containing branches
- **THEN** the right-rail minimap represents the same nodes and parent-child links as the center graph and distinguishes the opened node

#### Scenario: Minimap navigation opens a different node
- **WHEN** a learner activates another node through the right-rail minimap
- **THEN** that node's conversation opens in the center region and the minimap distinguishes the newly opened node
