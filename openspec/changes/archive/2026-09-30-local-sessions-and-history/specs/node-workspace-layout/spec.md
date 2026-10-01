## MODIFIED Requirements

### Requirement: Left rail indexes nodes only
The left rail SHALL provide access to nodes ordered by last activity, grouped by day, with each entry previewing its most recent message, and SHALL provide search across node titles and message content. The left rail SHALL NOT list conversation threads as entries of their own, and SHALL NOT replace the graph: navigation between nodes SHALL remain available through the graph and the minimap.

#### Scenario: Left rail lists nodes by recency
- **WHEN** the learner opens the workspace
- **THEN** the left rail lists nodes by last activity, most recent first, grouped by day

#### Scenario: Left rail excludes threads
- **WHEN** a node contains one or more spawned threads
- **THEN** none of those threads appear in the left rail as entries of their own

#### Scenario: Search returns nodes
- **WHEN** the learner enters a search term in the left rail
- **THEN** matching nodes are listed, and activating one opens it in the center region

#### Scenario: The graph remains available beside the history
- **WHEN** no node is open
- **THEN** the center region renders the graph while the left rail shows the history
