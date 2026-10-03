## ADDED Requirements

### Requirement: Commands are reached through a transient overlay, not a fourth pane
The workspace SHALL continue to present exactly three panes while offering commands. The command palette SHALL render above all three panes as a transient overlay and SHALL NOT add a pane, occupy a persistent region, resize a pane, or reflow pane content while it is open or after it closes. The overlay SHALL remain legible and operable at a window size of 800×600 without the panes being reflowed.

#### Scenario: Opening the palette leaves the panes in place
- **WHEN** the learner opens the command palette with a node open
- **THEN** the left rail, the center region, and the right rail keep their positions and content, and no fourth region is added

#### Scenario: Closing the palette restores the workspace unchanged
- **WHEN** the learner dismisses the command palette
- **THEN** the workspace is in the same state it was in before the palette opened

#### Scenario: The overlay holds at minimum window size
- **WHEN** the window is 800×600 and the command palette is open
- **THEN** the palette's query field and its results are legible and the three panes are not reflowed

### Requirement: The left rail's node search remains alongside the command palette
The left rail SHALL continue to provide search across nodes. The command palette SHALL NOT replace, disable, or take over that search, and left-rail search results SHALL remain nodes only even though the palette also returns commands.

#### Scenario: Both search surfaces remain usable
- **WHEN** a learner searches in the left rail and then opens the command palette
- **THEN** the left-rail search still lists matching nodes and the palette independently lists commands and nodes

#### Scenario: The left rail does not gain commands
- **WHEN** a learner enters a search term in the left rail that matches a command name
- **THEN** the left rail lists only matching nodes and no commands
