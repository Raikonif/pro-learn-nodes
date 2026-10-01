## Purpose

The keyboard-first overlay that searches commands, nodes, and projects in one query, giving every registry command a reachable home without adding a pane or a permanent control to the workspace.

## ADDED Requirements

### Requirement: The palette opens on a keyboard shortcut from anywhere in the workspace
The workspace SHALL open the command palette when the learner presses the palette shortcut, regardless of which pane holds focus and regardless of whether a node is open. The shortcut SHALL be a single chord and SHALL be usable while the conversation composer has focus. Opening the palette SHALL NOT alter, submit, or clear any composer draft.

#### Scenario: Palette opens from the graph
- **WHEN** the learner presses the palette shortcut while the center region shows the graph
- **THEN** the palette opens with an empty query and keyboard focus in its query field

#### Scenario: Palette opens from the composer without disturbing the draft
- **WHEN** the learner has typed an unsent message in the composer and presses the palette shortcut
- **THEN** the palette opens and the composer still contains the unsent message unchanged

### Requirement: Escape dismisses the palette with no side effects
Pressing Escape while the palette is open SHALL close it, discard the query, perform no command, and return keyboard focus to the element that held it when the palette opened. Closing the palette by any other means SHALL behave identically.

#### Scenario: Escape closes and restores focus
- **WHEN** the learner presses Escape while the palette is open
- **THEN** the palette closes, no command runs, and focus returns to whatever held it before the palette opened

#### Scenario: A dismissed palette reopens empty
- **WHEN** the learner types a query, dismisses the palette, and reopens it
- **THEN** the query field is empty

### Requirement: The palette searches commands, nodes, and projects in one query
A single query SHALL be matched against the registry's commands, the account's nodes, and the account's projects. Matching SHALL consider a command's name and description and a node's or project's title, and SHALL match characters appearing in order even when not adjacent, so a partial or abbreviated query still finds its target.

#### Scenario: One query returns more than one kind of result
- **WHEN** the learner types a term that matches both a skill command and a node title
- **THEN** the palette lists both, each labelled with the category it belongs to

#### Scenario: An abbreviated query matches
- **WHEN** the learner types a query whose characters appear in order within a command's name but not adjacently
- **THEN** that command is listed among the results

### Requirement: Results are grouped into ordered categories
Results SHALL be grouped into exactly three labelled categories rendered in the order Commands, Nodes, Projects. Within a category, results SHALL be ordered by match quality, and unavailable commands SHALL be ordered after available ones. Each category SHALL render at most a bounded number of results and SHALL indicate when its results were truncated.

#### Scenario: Categories render in fixed order
- **WHEN** a query matches commands, nodes, and projects
- **THEN** the Commands group is rendered first, the Nodes group second, and the Projects group third

#### Scenario: Unavailable commands sort last within their category
- **WHEN** a query matches both an available and an unavailable command
- **THEN** the available command is listed before the unavailable one

#### Scenario: Truncation is stated
- **WHEN** a category has more matches than it renders
- **THEN** the palette indicates that further matches were not listed

### Requirement: The empty query lists available commands before recent destinations
With an empty query the palette SHALL list the commands currently available, then the account's recently opened nodes in recency order, then its projects. The palette SHALL NOT open on an empty result set while any command is available.

#### Scenario: Opening the palette reveals what can be done
- **WHEN** the learner opens the palette and types nothing
- **THEN** the currently available commands are listed first, followed by recently opened nodes and then projects

#### Scenario: A learner discovers an installed skill without knowing its name
- **WHEN** a learner who has just installed a skill opens the palette with a node open and types nothing
- **THEN** that skill's commands are listed among the available commands

### Requirement: The palette is fully operable from the keyboard
The palette SHALL support moving the highlight to the next and previous result with the arrow keys, traversing across category boundaries without a separate keystroke, and activating the highlighted result with Enter. The first available result SHALL be highlighted whenever the result set changes. Activating a result SHALL close the palette before its effect is applied.

#### Scenario: Arrow keys cross category boundaries
- **WHEN** the highlight is on the last result of the Commands group and the learner presses the down arrow
- **THEN** the highlight moves to the first result of the Nodes group

#### Scenario: Enter activates the highlighted result
- **WHEN** the learner presses Enter while a node result is highlighted
- **THEN** the palette closes and that node opens in the center region

#### Scenario: Highlight resets as the query narrows
- **WHEN** the learner types a further character that changes the result set
- **THEN** the first available result of the new set is highlighted

### Requirement: A query with no match says so and does nothing
When a query matches no command, node, or project, the palette SHALL state that nothing matched and SHALL leave Enter without effect. The palette SHALL NOT create a node, a project, or a command from an unmatched query.

#### Scenario: No results reported
- **WHEN** the learner types a query matching nothing
- **THEN** the palette states that nothing matched

#### Scenario: Enter on an empty result set is inert
- **WHEN** the learner presses Enter while nothing matched
- **THEN** the palette stays open, nothing is created, and no command runs

### Requirement: The palette is an overlay, never a pane
The palette SHALL render above the workspace as a dismissible overlay and SHALL NOT occupy or displace the left rail, the center region, or the right rail. The workspace SHALL remain in the state it was in when the palette opened, and dismissing the palette SHALL reveal it unchanged.

#### Scenario: The panes survive the palette
- **WHEN** the palette is open over a workspace with a node open
- **THEN** the left rail, the center conversation, and the right rail retain their content and the palette obscures rather than replaces them

### Requirement: The palette requires an active account
The palette SHALL be available only while an account is active. While no account is active the palette shortcut SHALL have no effect and no palette SHALL render.

#### Scenario: The shortcut is inert while signed out
- **WHEN** the learner presses the palette shortcut on the sign-in surface
- **THEN** no palette opens and the sign-in surface is unchanged

#### Scenario: Signing out closes an open palette
- **WHEN** the active account is signed out while the palette is open
- **THEN** the palette closes and the root view becomes the sign-in surface

### Requirement: Palette results are confined to the active account
Node and project results SHALL be drawn only from the active account's data. No node or project belonging to another enrolled account SHALL appear in results, and switching accounts SHALL replace the result set entirely.

#### Scenario: Another account's nodes are absent
- **WHEN** a learner signs in as a second account and searches the palette for a node title created under the first account
- **THEN** that node is not listed
