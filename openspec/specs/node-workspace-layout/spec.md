# node-workspace-layout Specification

## Purpose

The three-pane working surface where a learner navigates the session graph, enters a node's conversation, and reaches practice tools — arranged so the shape of the graph stays visible even while working inside a single node.

## Requirements

### Requirement: Workspace presents three panes
The workspace SHALL present exactly three panes: a left rail indexing nodes, a center region holding either the graph or an open node's conversation, and a right rail. The workspace SHALL be the root view of the application window whenever an account is active. When no account is active, the sign-in surface SHALL be the root view instead, and the workspace SHALL NOT render.

#### Scenario: Window opens on the workspace
- **WHEN** the application window opens while an account is active
- **THEN** the visible content is the workspace showing a left rail, a center region, and a right rail

#### Scenario: Window opens signed out
- **WHEN** the application window opens while no account is active
- **THEN** the visible content is the sign-in surface and no workspace pane is rendered

#### Scenario: Signing in reveals the workspace
- **WHEN** a learner completes sign-in from the sign-in surface
- **THEN** the root view becomes the workspace with its three panes

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

### Requirement: Entering a node moves the conversation to the center and the graph to the right rail
When a node is opened, the center region SHALL render that node's conversation, and the graph SHALL move into the right rail as a minimap. The graph SHALL NOT be dismissed or hidden on entering a node.

#### Scenario: Node entry relocates both surfaces
- **WHEN** the learner opens a node from the center graph
- **THEN** the center region renders that node's conversation and the graph is rendered as a minimap in the right rail

#### Scenario: Leaving a node restores the graph to the center
- **WHEN** the learner closes the open node
- **THEN** the center region renders the session graph again and the right-rail minimap is removed

### Requirement: Minimap indicates and changes position
The right-rail minimap SHALL visually distinguish the currently open node from all other nodes. Activating a different node in the minimap SHALL open that node in the center region without returning to the center graph first.

#### Scenario: Open node is distinguished in the minimap
- **WHEN** a node is open
- **THEN** the minimap renders that node in a visually distinct state from every other node

#### Scenario: Minimap navigates directly between nodes
- **WHEN** the learner activates a different node in the minimap
- **THEN** the center region switches to that node's conversation and the minimap updates which node is distinguished

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

### Requirement: Workspace is styled with Tailwind utilities and remains legible at 800×600
The workspace SHALL be styled using Tailwind utility classes only, with no custom CSS files. Inline `style` props SHALL NOT be used, with one exception: a pane's width MAY be set through a single CSS custom property per pane, because a width chosen by dragging cannot be a fixed utility class. All three panes SHALL remain legible and usable at a window size of 800×600, except a rail the learner has collapsed.

#### Scenario: Styling uses Tailwind utilities
- **WHEN** the workspace is inspected in the browser
- **THEN** the rendered HTML uses Tailwind class names and no custom stylesheet is loaded, and the only inline style is a pane-width custom property on each rail

#### Scenario: Layout holds at minimum window size
- **WHEN** the window is resized to 800×600 with no rail collapsed
- **THEN** all three panes remain visible and their contents remain legible

### Requirement: Graph and minimap use a consistent node-card representation
The center graph and right-rail minimap SHALL represent the same workspace nodes and parent-child links. The center graph SHALL use chat-like node cards, and the minimap SHALL visibly distinguish the open node while preserving direct navigation to another node.

#### Scenario: Canvas and minimap agree on graph contents
- **WHEN** a learner opens a node in a workspace containing branches
- **THEN** the right-rail minimap represents the same nodes and parent-child links as the center graph and distinguishes the opened node

#### Scenario: Minimap navigation opens a different node
- **WHEN** a learner activates another node through the right-rail minimap
- **THEN** that node's conversation opens in the center region and the minimap distinguishes the newly opened node

### Requirement: Workspace chrome shows the active account
While an account is active, the workspace SHALL display the active account's identity and SHALL offer signing out from that display. The display SHALL NOT occupy a fourth pane.

#### Scenario: Active account is visible while working
- **WHEN** an account is active and a node is open
- **THEN** the active account's display name is visible in the workspace chrome without hiding the left rail, center region, or right rail

#### Scenario: Signing out returns to the sign-in surface
- **WHEN** a learner signs out from the account display
- **THEN** the root view becomes the sign-in surface
