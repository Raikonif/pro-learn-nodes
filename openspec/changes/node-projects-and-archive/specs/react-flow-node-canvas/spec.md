## MODIFIED Requirements

### Requirement: Canvas renders every workspace node and branch as a chat-like graph
The workspace SHALL render every unarchived workspace node as one compact chat-like card and every node link between two rendered nodes as one directed connection from parent to child. A node card SHALL show the node title and a visual cue for its configured mode. The canvas SHALL NOT render conversation threads as graph nodes, and SHALL NOT render a card for an archived node.

#### Scenario: A branched graph is rendered
- **WHEN** the workspace graph contains a parent node, child nodes, and side threads on either node
- **THEN** the canvas renders one card per node, one connection per parent-child link, and no card for a side thread

#### Scenario: Archived nodes are absent from the canvas
- **WHEN** the workspace graph contains archived and unarchived nodes
- **THEN** the canvas renders a card only for each unarchived node

## ADDED Requirements

### Requirement: The canvas renders projects as grouping within one graph
The canvas SHALL render the nodes of every unarchived project in a single graph, visually grouping the cards of each project and identifying each group by its project. The canvas SHALL NOT present a separate graph per project, and SHALL NOT require a learner to choose a project before a graph is rendered.

#### Scenario: Several projects share one canvas
- **WHEN** the workspace holds nodes belonging to three different projects
- **THEN** the canvas renders all of their cards in one graph, with the cards of each project visually grouped and the group identified by its project

#### Scenario: No project selection is required to see the graph
- **WHEN** a learner opens the workspace without choosing a project
- **THEN** the canvas renders the whole unarchived graph rather than an empty canvas or a project chooser

### Requirement: The canvas draws links that cross project groups
The canvas SHALL draw a connection between two rendered nodes whose projects differ, in the same way it draws a connection within one project. Grouping SHALL NOT suppress, reroute around, or redraw as separate a link whose ends fall in different groups. A node reachable from parents in two different projects SHALL be rendered once, in the group of the project it belongs to, with a connection from each parent.

#### Scenario: A cross-project connection is drawn
- **WHEN** a parent node in one project has a child node in another project
- **THEN** the canvas draws one directed connection from the parent card to the child card, crossing the two groups

#### Scenario: A shared child is rendered once in its own group
- **WHEN** one node is the child of parents in two different projects
- **THEN** the canvas renders one card for that child, inside the group of the project it belongs to, with a connection from each parent

### Requirement: The canvas indicates a link whose other end is archived
When a rendered node has a link to a node that is archived, the canvas SHALL indicate on the rendered node that such a link exists rather than omitting it silently. Activating that indication SHALL identify the archived node and offer to restore it.

#### Scenario: A link to archived material is indicated
- **WHEN** a rendered node is linked to a node that has been archived
- **THEN** the canvas indicates on the rendered node that it has a link to archived material

#### Scenario: Restoring redraws the connection
- **WHEN** a learner restores the archived node through that indication
- **THEN** the canvas renders a card for the restored node and draws the connection between the two
