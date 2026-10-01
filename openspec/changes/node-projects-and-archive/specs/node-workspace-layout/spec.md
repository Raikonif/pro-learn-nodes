## MODIFIED Requirements

### Requirement: Left rail indexes nodes only
The left rail SHALL provide recency-ordered access to unarchived nodes, grouped by the project each node belongs to, and search across nodes. The left rail SHALL NOT list conversation threads, SHALL NOT list archived nodes or archived projects in its recency listing, and SHALL NOT present nodes as a flat chat history in place of the graph. Navigation between nodes SHALL remain available through the graph and the minimap.

#### Scenario: Left rail lists nodes by recency
- **WHEN** the learner opens the workspace
- **THEN** the left rail lists recently opened unarchived nodes, most recent first, under the project each belongs to

#### Scenario: Left rail excludes threads
- **WHEN** a node contains one or more spawned threads
- **THEN** none of those threads appear in the left rail

#### Scenario: Archived material is absent from the recency listing
- **WHEN** the learner archives a node or a project
- **THEN** that node, or that project and the nodes archived with it, no longer appear in the left rail's recency listing

#### Scenario: Search returns nodes
- **WHEN** the learner enters a search term in the left rail
- **THEN** matching nodes are listed, and activating one opens it in the center region

## ADDED Requirements

### Requirement: Left-rail search reaches archived material without cluttering the default result set
The left rail's search SHALL exclude archived nodes and archived projects by default and SHALL offer an explicit control to include them. When archived material is included, each archived result SHALL be marked as archived, and activating it SHALL open it without changing its archived state.

#### Scenario: Default search results omit archived nodes
- **WHEN** the learner searches in the left rail without including archived material
- **THEN** no archived node appears among the results

#### Scenario: Including archived material marks the results
- **WHEN** the learner turns on the control to include archived material and repeats the search
- **THEN** matching archived nodes appear, each marked as archived

#### Scenario: Opening an archived result does not restore it
- **WHEN** the learner activates an archived search result
- **THEN** that node opens in the center region, is indicated as archived, and remains archived

### Requirement: The learner can reach project management from the workspace without a fourth pane
The workspace SHALL make creating a project, moving the open node into a project, and archiving or restoring a project reachable from within the three panes. These affordances SHALL NOT introduce a fourth pane and SHALL NOT displace the graph from the center region or the minimap from the right rail.

#### Scenario: Project actions are reachable while a node is open
- **WHEN** a node is open in the center region
- **THEN** the learner can move it into a different project without leaving the workspace

#### Scenario: Project management adds no pane
- **WHEN** the learner opens the project management affordance
- **THEN** the workspace still presents exactly three panes and the minimap remains visible
