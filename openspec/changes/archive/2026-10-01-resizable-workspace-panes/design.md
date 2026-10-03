## Context

`app/Workspace.tsx` lays out three columns with fixed Tailwind widths (`w-44 lg:w-56` left, `w-48 lg:w-72` right). The right rail now carries a code editor, an exercise list, quizzes, and the minimap. `node-workspace-layout` forbids inline `style` props, which is what has kept every width a fixed class.

## Decisions

### Widths through CSS custom properties, the one allowed inline style

Each rail gets `style={{ '--left-rail': '<n>px' }}` (respectively `--right-rail`) and the class `w-[var(--left-rail)]`. Tailwind still owns the styling, and the only dynamic value is a number. The spec is amended to allow exactly this, rather than the rule being broken quietly.

### Limits

| | default | min | max |
|---|---|---|---|
| Left rail | 240px | 180px | 420px |
| Right rail | 320px | 240px | 50% of the window |
| Center | — | 380px | — |

Collapsed rails are a 28px strip. The minimap's breadcrumb collapse (`node-workspace-layout`) keeps working: it responds to the rail's height, not its width.

### The handle is an ARIA separator, driven by pointer events

A `ResizeHandle` on each inner edge: `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max`, `tabIndex=0`. Pointer events with pointer capture for dragging, so a fast drag that leaves the 4px handle keeps tracking; arrow keys move 16px (64px with Shift); double-click resets. While dragging, text selection is suppressed in the workspace, so a drag does not select the conversation.

### One layout store, persisted per device in `localStorage`

`shared/lib/pane-layout.ts`: a small zustand store `{ left: { width, collapsed }, right: { width, collapsed } }`, written to `localStorage` on change (debounced) and read at start, both wrapped so that a failure falls back to defaults. Per device, not per account and not in SQLite: the right width depends on the screen, and a learner moving between a laptop and a monitor wants each to remember its own. This is a view preference, like the selected practice tool, and `local-workspace-persistence`'s rule that the frontend is not authoritative applies to workspace *data*, not to how the window is arranged.

### The window resizing clamps, the store keeps the intent

On window resize the rendered widths are clamped so the center keeps 380px — the right rail gives way first, then the left — but the stored widths are not rewritten. Widening the window again restores what the learner chose.

## Risks / Trade-offs

- **Tauri's webview and `localStorage`**: it persists across launches in the app's data directory. Clearing site data resets the layout and nothing else.
- **Drag performance**: widths update a CSS variable per pointer move; React re-renders only the workspace shell, not the conversation, because the width lives in the shell's style.

## Migration Plan

None. The first launch uses the defaults, which are wider than today's widths.
