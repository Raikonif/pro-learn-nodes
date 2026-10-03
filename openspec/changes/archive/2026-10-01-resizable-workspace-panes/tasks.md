## 1. Layout store

- [x] 1.1 Tests first (`shared/lib/pane-layout.test.ts`): defaults; set width clamps to min/max; collapse/expand restores the previous width; persists to and restores from `localStorage`; a storage read or write that throws leaves the defaults working; a stored arrangement wider than the window is clamped when rendered without rewriting the stored intent
- [x] 1.2 Implement `shared/lib/pane-layout.ts` (zustand, debounced persistence, `fitToWindow(widths, windowWidth)` pure helper)

## 2. Resize handle

- [x] 2.1 Tests first (`shared/components/ResizeHandle.test.tsx`): renders a focusable `separator` with `aria-valuenow/min/max`; pointer drag reports width changes and stops at the limits; ArrowLeft/ArrowRight move by 16px (Shift 64px) in the right direction for each side; double-click resets
- [x] 2.2 Implement `ResizeHandle` with pointer capture and text-selection suppression during a drag

## 3. Workspace

- [x] 3.1 `app/Workspace.tsx`: rails sized by `--left-rail` / `--right-rail` with `w-[var(...)]`; handles on the inner edges; collapse controls in the header and a 28px strip for a collapsed rail; window resize clamps per design; tests (collapsing keeps an open node, a selected practice tool, and a search)
- [x] 3.2 Update the existing Tailwind/inline-style test to allow exactly the two pane-width custom properties and nothing else
- [x] 3.3 Playwright: drag the right rail wider, reload, it is still wider; collapse the left rail, the conversation widens, expand restores it; at 800×600 the center keeps its minimum; keyboard resize moves the rail

## 4. Verification

- [x] 4.1 Full suites green; rebuild the bundle; in the built app, resize the rails and restart
