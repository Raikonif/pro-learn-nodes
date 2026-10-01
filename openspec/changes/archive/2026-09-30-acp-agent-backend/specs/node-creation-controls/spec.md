## MODIFIED Requirements

### Requirement: Whole-node creation creates and opens an unanchored child
Activating a node card's child-session action SHALL create a child node linked to that card's node, create the child's main thread, and open the child in the workspace. The new link SHALL have no selection anchor. The child SHALL inherit the parent node's mode, active skills, MCP servers, and conversation backend.

#### Scenario: Child is created from a node card
- **WHEN** a learner activates the child-session action on a node card
- **THEN** a new node and its main thread are created, the graph contains a link from the selected parent to the new child with no selection anchor, and the child conversation opens

#### Scenario: Child inherits its parent configuration
- **WHEN** a learner creates a child node from a parent with a configured mode, active skills, MCP servers, and conversation backend
- **THEN** the child has the same mode, active skills, MCP servers, and conversation backend

#### Scenario: Child inherits a backend that is not currently reachable
- **WHEN** a learner creates a child node from a parent whose configured conversation backend is not installed or not authenticated on this device
- **THEN** the child is created with the same backend and its unreachability is reported when a turn is attempted, rather than the child being created with a different backend or its creation being refused
