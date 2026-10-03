import { create } from 'zustand'

/**
 * How the workspace's rails are arranged on this device: their widths and
 * whether each is collapsed.
 *
 * A view preference, not workspace data — it lives in `localStorage`, per
 * device, because the right width depends on the screen. Every read and write
 * is wrapped so a storage failure (private window, cleared or blocked site
 * data) leaves the default layout working.
 *
 * The store keeps the learner's INTENT. What is rendered is `fitToWindow` of
 * that intent, so narrowing the window never rewrites what they chose and
 * widening it again restores it.
 */

export type RailSide = 'left' | 'right'

export interface RailLayout {
  width: number
  collapsed: boolean
}

export interface PaneLayout {
  left: RailLayout
  right: RailLayout
}

export const LEFT_RAIL = { default: 240, min: 180, max: 420 } as const
/** The right rail's maximum is half the window; see `rightRailMax`. */
export const RIGHT_RAIL = { default: 320, min: 240 } as const
export const CENTER_MIN = 380
export const COLLAPSED_STRIP = 28

export const PANE_LAYOUT_STORAGE_KEY = 'learn-nodes.pane-layout'
const PERSIST_DEBOUNCE_MS = 250

export function rightRailMax(windowWidth: number): number {
  return Math.max(RIGHT_RAIL.min, Math.floor(windowWidth / 2))
}

export function railMin(side: RailSide): number {
  return side === 'left' ? LEFT_RAIL.min : RIGHT_RAIL.min
}

export function railMax(side: RailSide, windowWidth: number): number {
  return side === 'left' ? LEFT_RAIL.max : rightRailMax(windowWidth)
}

export function railDefault(side: RailSide): number {
  return side === 'left' ? LEFT_RAIL.default : RIGHT_RAIL.default
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function currentWindowWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth
}

export function defaultLayout(): PaneLayout {
  return {
    left: { width: LEFT_RAIL.default, collapsed: false },
    right: { width: RIGHT_RAIL.default, collapsed: false },
  }
}

/**
 * The widths to render for a stored arrangement in a window this wide.
 *
 * Each rail is first held to its own limits; then, if the center would go
 * below its minimum, the right rail gives way first and the left after it,
 * each only down to its own minimum. A collapsed rail renders as its strip.
 */
export function fitToWindow(layout: PaneLayout, windowWidth: number): { left: number; right: number } {
  let left = layout.left.collapsed
    ? COLLAPSED_STRIP
    : clamp(layout.left.width, LEFT_RAIL.min, LEFT_RAIL.max)
  let right = layout.right.collapsed
    ? COLLAPSED_STRIP
    : clamp(layout.right.width, RIGHT_RAIL.min, rightRailMax(windowWidth))

  let overflow = left + right - (windowWidth - CENTER_MIN)
  if (overflow > 0 && !layout.right.collapsed) {
    const give = Math.min(overflow, right - RIGHT_RAIL.min)
    right -= give
    overflow -= give
  }
  if (overflow > 0 && !layout.left.collapsed) {
    const give = Math.min(overflow, left - LEFT_RAIL.min)
    left -= give
  }
  return { left, right }
}

function parseRail(value: unknown, side: RailSide): RailLayout {
  const fallback = { width: railDefault(side), collapsed: false }
  if (typeof value !== 'object' || value === null) return fallback
  const record = value as Record<string, unknown>
  const width =
    typeof record.width === 'number' && Number.isFinite(record.width)
      ? Math.max(railMin(side), side === 'left' ? Math.min(LEFT_RAIL.max, record.width) : record.width)
      : fallback.width
  const collapsed = typeof record.collapsed === 'boolean' ? record.collapsed : false
  return { width, collapsed }
}

/** The stored arrangement, or the defaults if there is none or it cannot be read. */
export function readStoredLayout(): PaneLayout {
  try {
    const raw = window.localStorage.getItem(PANE_LAYOUT_STORAGE_KEY)
    if (raw === null) return defaultLayout()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultLayout()
    const record = parsed as Record<string, unknown>
    return { left: parseRail(record.left, 'left'), right: parseRail(record.right, 'right') }
  } catch {
    return defaultLayout()
  }
}

function writeStoredLayout(layout: PaneLayout): void {
  try {
    window.localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({ left: layout.left, right: layout.right }),
    )
  } catch {
    // A view preference that cannot be stored is simply not remembered.
  }
}

interface PaneLayoutState extends PaneLayout {
  /** Sets a rail's width, held to that rail's limits. */
  setWidth: (side: RailSide, width: number, windowWidth?: number) => void
  resetWidth: (side: RailSide) => void
  setCollapsed: (side: RailSide, collapsed: boolean) => void
  toggleCollapsed: (side: RailSide) => void
  /** Re-reads the stored arrangement. */
  restore: () => void
  /** Back to the defaults (tests). */
  reset: () => void
}

export const usePaneLayout = create<PaneLayoutState>()((set) => ({
  ...readStoredLayout(),

  setWidth: (side, width, windowWidth = currentWindowWidth()) =>
    set((state) => ({
      [side]: {
        ...state[side],
        width: Math.round(clamp(width, railMin(side), railMax(side, windowWidth))),
      },
    })),

  resetWidth: (side) => set((state) => ({ [side]: { ...state[side], width: railDefault(side) } })),

  setCollapsed: (side, collapsed) => set((state) => ({ [side]: { ...state[side], collapsed } })),

  toggleCollapsed: (side) =>
    set((state) => ({ [side]: { ...state[side], collapsed: !state[side].collapsed } })),

  restore: () => set(readStoredLayout()),

  reset: () => set(defaultLayout()),
}))

let pendingWrite: ReturnType<typeof setTimeout> | undefined

usePaneLayout.subscribe((state, previous) => {
  if (state.left === previous.left && state.right === previous.right) return
  if (pendingWrite !== undefined) clearTimeout(pendingWrite)
  pendingWrite = setTimeout(() => {
    pendingWrite = undefined
    const { left, right } = usePaneLayout.getState()
    writeStoredLayout({ left, right })
  }, PERSIST_DEBOUNCE_MS)
})
