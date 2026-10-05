## ADDED Requirements

### Requirement: An open node's center holds the conversation and, when there is code, a Code tab
When a node is open and has code, the center region SHALL offer two tabs — the conversation and Code — showing one at a time, and SHALL default to the conversation. Switching tabs SHALL NOT add a pane, move the minimap or the practice tools, or interrupt a turn in progress; while Code is shown, the conversation tab SHALL indicate a turn in progress. The tabs SHALL remain legible and operable at 800×600.

#### Scenario: Switching to Code keeps three panes
- **WHEN** the learner switches an open node's center region to the Code tab
- **THEN** the left rail, the center region, and the right rail keep their positions, and no fourth region is added

#### Scenario: A turn continues while Code is shown
- **WHEN** a turn is streaming and the learner switches to the Code tab
- **THEN** the turn continues, the conversation tab shows that it is in progress, and switching back shows everything that arrived

#### Scenario: Opening a node starts on the conversation
- **WHEN** the learner opens a node that has code
- **THEN** the center region shows the conversation, with the Code tab available beside it
