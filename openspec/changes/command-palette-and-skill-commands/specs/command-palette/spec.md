## Purpose

The keyboard-first overlay that searches commands and nodes in one query, giving every registry command a reachable home without adding a pane or a permanent control to the workspace.

## ADDED Requirements

### Requirement: The palette opens on a keyboard shortcut from anywhere in the workspace
The workspace SHALL open the command palette when the learner presses ⌘K on macOS or Ctrl+K elsewhere, regardless of which pane holds focus and whether a node is open. The shortcut SHALL work while the conversation composer has focus, and opening the palette SHALL NOT alter, submit, or clear any composer draft.

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

### Requirement: The palette searches commands and nodes in one query
A single query SHALL be matched against the registry's commands and the account's nodes that are not archived. Matching SHALL consider a command's title, group, and description and a node's title, and SHALL match characters appearing in order even when not adjacent, so a partial or abbreviated query still finds its target.

#### Scenario: One query returns both kinds of result
- **WHEN** the learner types a term that matches both a command and a node title
- **THEN** the palette lists both, each under the category it belongs to

#### Scenario: An abbreviated query matches
- **WHEN** the learner types characters that appear in order, not adjacently, within a command's title
- **THEN** that command is listed among the results

### Requirement: Results are grouped and ordered
Results SHALL be grouped into Commands, then Nodes. Within Commands, results SHALL be ordered by match quality, available before unavailable, and each command SHALL show its group (Workspace, Practice, Session, or the agent's name). Each category SHALL render a bounded number of results and SHALL state when more matched than are shown.

#### Scenario: Commands come before nodes
- **WHEN** a query matches commands and nodes
- **THEN** the Commands category is rendered before the Nodes category

#### Scenario: Unavailable commands sort last
- **WHEN** a query matches an available and an unavailable command
- **THEN** the available one is listed first, and the unavailable one shows its reason

#### Scenario: Truncation is stated
- **WHEN** a category has more matches than it renders
- **THEN** the palette states how many more matched

### Requirement: The empty query lists available commands before recent nodes
With an empty query the palette SHALL list the currently available commands, then the account's most recently active nodes other than the open one.

#### Scenario: Opening the palette reveals what can be done
- **WHEN** the learner opens the palette and types nothing
- **THEN** available commands are listed first, followed by recently active nodes

### Requirement: The palette is fully operable from the keyboard
The arrow keys SHALL move the highlight to the next and previous result across category boundaries, and Enter SHALL activate the highlighted result. The first result SHALL be highlighted whenever the result set changes. Activating a result SHALL close the palette before its effect applies; activating a node SHALL open it.

#### Scenario: Arrow keys cross categories
- **WHEN** the highlight is on the last command and the learner presses the down arrow
- **THEN** the highlight moves to the first node

#### Scenario: Enter opens a node
- **WHEN** the learner presses Enter while a node is highlighted
- **THEN** the palette closes and that node opens in the center region

#### Scenario: Enter on an unavailable command does nothing
- **WHEN** the learner presses Enter while an unavailable command is highlighted
- **THEN** the palette stays open and nothing runs

### Requirement: A query with no match says so and does nothing
When a query matches nothing, the palette SHALL state that nothing matched and Enter SHALL have no effect. The palette SHALL NOT create a node or a command from an unmatched query.

#### Scenario: Nothing matched
- **WHEN** the learner types a query matching nothing and presses Enter
- **THEN** the palette states that nothing matched, stays open, and nothing is created

### Requirement: The palette requires an active account and shows only its nodes
The palette SHALL exist only while an account is active; while signed out the shortcut SHALL have no effect. Node results SHALL come only from the active account.

#### Scenario: The shortcut is inert while signed out
- **WHEN** the learner presses the palette shortcut on the sign-in surface
- **THEN** no palette opens

#### Scenario: Another account's nodes are absent
- **WHEN** a learner signs in as a second account and searches for a node title created under the first
- **THEN** that node is not listed
