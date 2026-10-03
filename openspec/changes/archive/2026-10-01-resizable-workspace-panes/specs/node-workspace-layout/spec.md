## MODIFIED Requirements

### Requirement: Workspace is styled with Tailwind utilities and remains legible at 800×600
The workspace SHALL be styled using Tailwind utility classes only, with no custom CSS files. Inline `style` props SHALL NOT be used, with one exception: a pane's width MAY be set through a single CSS custom property per pane, because a width chosen by dragging cannot be a fixed utility class. All three panes SHALL remain legible and usable at a window size of 800×600, except a rail the learner has collapsed.

#### Scenario: Styling uses Tailwind utilities
- **WHEN** the workspace is inspected in the browser
- **THEN** the rendered HTML uses Tailwind class names and no custom stylesheet is loaded, and the only inline style is a pane-width custom property on each rail

#### Scenario: Layout holds at minimum window size
- **WHEN** the window is resized to 800×600 with no rail collapsed
- **THEN** all three panes remain visible and their contents remain legible
