## MODIFIED Requirements

### Requirement: Right rail stacks the minimap above the practice tools
While a node is open, the right rail SHALL render the minimap at its top and the practice workbench below it, filling the remaining height. The minimap SHALL NOT be a block of the workbench, and no workbench action SHALL remove it. While a workbench block is expanded, the minimap SHALL render collapsed to its breadcrumb so the block has the rail's height; while no block is expanded, it SHALL render in full.

#### Scenario: Both surfaces visible simultaneously
- **WHEN** a node is open and no workbench block is expanded
- **THEN** the full minimap renders above the workbench's block headers

#### Scenario: An expanded block takes the height
- **WHEN** the learner expands a workbench block
- **THEN** the minimap collapses to its breadcrumb and the block fills the height below it

### Requirement: Minimap collapses to a breadcrumb when vertical space is constrained
When a workbench block is expanded, or the right rail's height is insufficient for the minimap at its fixed height alongside the workbench, the minimap SHALL collapse to a breadcrumb strip naming the path to the open node. The collapsed breadcrumb SHALL expand to the full minimap on hover.

#### Scenario: Constrained height collapses the minimap
- **WHEN** the right rail has insufficient height for the minimap and the workbench
- **THEN** the minimap is replaced by a breadcrumb strip naming the path to the open node

#### Scenario: Hovering the breadcrumb restores the minimap
- **WHEN** the learner hovers the collapsed breadcrumb strip
- **THEN** the full minimap is rendered
