## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Workspace chrome shows the active account
While an account is active, the workspace SHALL display the active account's identity and SHALL offer signing out from that display. The display SHALL NOT occupy a fourth pane.

#### Scenario: Active account is visible while working
- **WHEN** an account is active and a node is open
- **THEN** the active account's display name is visible in the workspace chrome without hiding the left rail, center region, or right rail

#### Scenario: Signing out returns to the sign-in surface
- **WHEN** a learner signs out from the account display
- **THEN** the root view becomes the sign-in surface
