## MODIFIED Requirements

### Requirement: Graph occupies the center when no node is open
When no node is open, the center region SHALL render the session graph, and the right rail SHALL NOT render a minimap and SHALL NOT render the practice tools. The graph SHALL support entering a node by activating it.

#### Scenario: Idle workspace shows the graph
- **WHEN** the workspace is open and no node has been entered
- **THEN** the center region renders the session graph and the right rail shows no minimap

#### Scenario: Idle workspace shows no practice tools
- **WHEN** the workspace is open and no node has been entered
- **THEN** the right rail renders no practice tools and no practice content

#### Scenario: Activating a graph node enters it
- **WHEN** the learner activates a node in the center graph
- **THEN** that node is opened in the workspace
