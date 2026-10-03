## Why

The rails are fixed widths — the left 176px (224px on large screens), the right 192px (288px). The right rail now holds a Python editor, a list of code exercises, quizzes, and the minimap, and at 192px a line of code wraps after a few words. A learner cannot give the rail room when practising, or give the conversation room when reading, the way ChatGPT Desktop's resizable sidebar lets them.

## What Changes

- **Drag to resize** the left and right rails by their inner edge, within limits that keep the conversation usable; **double-click** an edge to restore the default width.
- **Keyboard resizing**: an edge is focusable and moved with the arrow keys, for learners who do not use a pointer.
- **Collapse and expand** either rail with a control in the header; a collapsed rail leaves a thin strip that expands it again.
- **Sizes and collapsed state persist** on this device across restarts.
- **The window shrinking never squeezes the conversation below its minimum**: rails give way first, down to their minimums.
- **BREAKING (spec)**: `node-workspace-layout` forbade inline `style` props; pane widths are the one value that cannot be a fixed Tailwind class, so the requirement is amended to allow a width set through a CSS custom property, and only that. Its "three panes visible at 800×600" now holds unless the learner collapsed one.

## Capabilities

### New Capabilities

- `resizable-panes`: resizing, collapsing, and remembering the workspace's rails.

### Modified Capabilities

- `node-workspace-layout`: the styling requirement allows pane widths through one CSS custom property, and the minimum-size requirement accounts for collapsed rails.

## Impact

- **Frontend only**: `app/Workspace.tsx` (rails sized by CSS custom properties), a `shared/components/ResizeHandle` and a `shared/lib/pane-layout` store persisted to `localStorage`; header collapse controls. No backend change.
- **Not in scope**: rearranging panes, detaching them into windows, per-session layouts.
