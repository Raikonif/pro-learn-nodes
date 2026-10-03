## Purpose

Lets the learner give room to what they are doing — the conversation when reading, the practice rail when coding — by resizing and collapsing the workspace's rails, and keeps that arrangement between sessions on the same device.

## ADDED Requirements

### Requirement: The rails can be resized by dragging their inner edge
Each rail SHALL be resizable by dragging the edge it shares with the center region. Each rail SHALL have a minimum and a maximum width, and the center region SHALL NOT be made narrower than its own minimum by any resize. Double-activating an edge SHALL restore that rail's default width.

#### Scenario: Widening the practice rail
- **WHEN** the learner drags the right rail's edge toward the center
- **THEN** the right rail widens as the pointer moves and the center region narrows accordingly

#### Scenario: A rail stops at its limits
- **WHEN** the learner drags a rail past its maximum, or far enough to make the center narrower than its minimum
- **THEN** the rail stops at the limit and the center keeps its minimum width

#### Scenario: Restoring the default
- **WHEN** the learner double-activates a rail's edge
- **THEN** the rail returns to its default width

### Requirement: The rails can be resized from the keyboard
Each resize edge SHALL be focusable, SHALL announce itself as a separator with its current width, and SHALL move its rail with the arrow keys in small steps, within the same limits as dragging.

#### Scenario: Resizing without a pointer
- **WHEN** the learner focuses the right rail's edge and presses the arrow key toward the center
- **THEN** the right rail widens by a step

### Requirement: Either rail can be collapsed and expanded
The workspace SHALL offer a control to collapse and to expand each rail. A collapsed rail SHALL leave a narrow strip from which it can be expanded, and expanding SHALL restore the width it had before collapsing. Collapsing a rail SHALL NOT discard its state: an open node, a selected practice tool, and a search in progress SHALL be as they were when it is expanded.

#### Scenario: Collapsing the history to read
- **WHEN** the learner collapses the left rail
- **THEN** the conversation takes the freed width, and expanding the rail restores it at its previous width with its search unchanged

### Requirement: The arrangement persists on this device
Rail widths and collapsed states SHALL be restored after the application restarts on the same device. A stored arrangement that no longer fits the window SHALL be adjusted to fit rather than applied as is. Failing to read or store the arrangement SHALL leave the default layout working.

#### Scenario: Widths survive a restart
- **WHEN** the learner widens the right rail and restarts the application
- **THEN** the right rail opens at the widened width

#### Scenario: A smaller window
- **WHEN** a stored arrangement is restored in a window too narrow for it
- **THEN** the rails are reduced so the center keeps its minimum width

### Requirement: Shrinking the window narrows the rails before the conversation
When the window narrows, the rails SHALL give way down to their minimums before the center region goes below its own minimum.

#### Scenario: Narrowing the window
- **WHEN** the window is narrowed from wide to 800 pixels with both rails widened
- **THEN** the rails shrink toward their minimums and the conversation stays at least its minimum width
