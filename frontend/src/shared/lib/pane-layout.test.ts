import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CENTER_MIN,
  COLLAPSED_STRIP,
  LEFT_RAIL,
  PANE_LAYOUT_STORAGE_KEY,
  RIGHT_RAIL,
  fitToWindow,
  readStoredLayout,
  rightRailMax,
  usePaneLayout,
} from './pane-layout'

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  usePaneLayout.getState().reset()
  vi.runAllTimers()
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('pane layout — limits', () => {
  it('matches the design table', () => {
    expect(LEFT_RAIL).toEqual({ default: 240, min: 180, max: 420 })
    expect(RIGHT_RAIL).toMatchObject({ default: 320, min: 240 })
    expect(CENTER_MIN).toBe(380)
    expect(COLLAPSED_STRIP).toBe(28)
  })

  it('caps the right rail at half the window, never below its minimum', () => {
    expect(rightRailMax(1600)).toBe(800)
    expect(rightRailMax(300)).toBe(RIGHT_RAIL.min)
  })
})

describe('pane layout — store', () => {
  it('starts at the defaults, expanded', () => {
    expect(usePaneLayout.getState().left).toEqual({ width: 240, collapsed: false })
    expect(usePaneLayout.getState().right).toEqual({ width: 320, collapsed: false })
  })

  it('clamps a width to the rail minimum and maximum', () => {
    const { setWidth } = usePaneLayout.getState()

    setWidth('left', 50)
    expect(usePaneLayout.getState().left.width).toBe(180)
    setWidth('left', 999)
    expect(usePaneLayout.getState().left.width).toBe(420)

    setWidth('right', 10, 1200)
    expect(usePaneLayout.getState().right.width).toBe(240)
    setWidth('right', 2000, 1200)
    expect(usePaneLayout.getState().right.width).toBe(600)
  })

  it('collapsing keeps the width, so expanding restores it', () => {
    const { setWidth, setCollapsed } = usePaneLayout.getState()
    setWidth('left', 300)

    setCollapsed('left', true)
    expect(usePaneLayout.getState().left).toEqual({ width: 300, collapsed: true })

    usePaneLayout.getState().toggleCollapsed('left')
    expect(usePaneLayout.getState().left).toEqual({ width: 300, collapsed: false })
  })

  it('resets one rail to its default width', () => {
    usePaneLayout.getState().setWidth('right', 400, 1600)
    usePaneLayout.getState().resetWidth('right')
    expect(usePaneLayout.getState().right.width).toBe(320)
  })
})

describe('pane layout — persistence', () => {
  it('writes the arrangement to localStorage after a debounce', () => {
    usePaneLayout.getState().setWidth('right', 400, 1600)
    usePaneLayout.getState().setCollapsed('left', true)
    expect(window.localStorage.getItem(PANE_LAYOUT_STORAGE_KEY)).toBeNull()

    vi.runAllTimers()

    expect(JSON.parse(window.localStorage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? 'null')).toEqual({
      left: { width: 240, collapsed: true },
      right: { width: 400, collapsed: false },
    })
  })

  it('restores a stored arrangement', () => {
    window.localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({ left: { width: 333, collapsed: true }, right: { width: 500, collapsed: false } }),
    )

    expect(readStoredLayout()).toEqual({
      left: { width: 333, collapsed: true },
      right: { width: 500, collapsed: false },
    })
    usePaneLayout.getState().restore()
    expect(usePaneLayout.getState().left).toEqual({ width: 333, collapsed: true })
    expect(usePaneLayout.getState().right.width).toBe(500)
  })

  it('falls back to the defaults for a malformed or partial record', () => {
    window.localStorage.setItem(PANE_LAYOUT_STORAGE_KEY, '{not json')
    expect(readStoredLayout().left).toEqual({ width: 240, collapsed: false })

    window.localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({ left: { width: 'wide' }, right: { width: 5000, collapsed: 'yes' } }),
    )
    const layout = readStoredLayout()
    expect(layout.left).toEqual({ width: 240, collapsed: false })
    expect(layout.right.collapsed).toBe(false)
    expect(layout.right.width).toBeGreaterThanOrEqual(RIGHT_RAIL.min)
  })

  it('a storage read that throws leaves the defaults working', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => usePaneLayout.getState().restore()).not.toThrow()
    expect(usePaneLayout.getState().left).toEqual({ width: 240, collapsed: false })
  })

  it('a storage write that throws leaves the store working', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    usePaneLayout.getState().setWidth('left', 300)
    expect(() => vi.runAllTimers()).not.toThrow()
    expect(usePaneLayout.getState().left.width).toBe(300)
  })
})

describe('pane layout — fitting the window', () => {
  const wide = {
    left: { width: 400, collapsed: false },
    right: { width: 600, collapsed: false },
  }

  it('renders the stored widths when they fit', () => {
    expect(fitToWindow(wide, 2000)).toEqual({ left: 400, right: 600 })
  })

  it('takes from the right rail first, then the left, keeping the center minimum', () => {
    // 1200 - 380 = 820 for the rails: the right gives up 180 before the left gives anything.
    expect(fitToWindow(wide, 1200)).toEqual({ left: 400, right: 420 })
    // 1000 - 380 = 620: the right is at its minimum, the left takes the rest.
    expect(fitToWindow(wide, 1000)).toEqual({ left: 380, right: 240 })
    expect(fitToWindow(wide, 800)).toEqual({ left: 180, right: 240 })
  })

  it('never goes below the rail minimums, even when the window cannot fit them', () => {
    expect(fitToWindow(wide, 600)).toEqual({ left: 180, right: 240 })
  })

  it('caps the right rail at half the window', () => {
    expect(fitToWindow({ ...wide, right: { width: 900, collapsed: false } }, 1600).right).toBe(800)
  })

  it('gives a collapsed rail its strip and the other rail the room', () => {
    const fitted = fitToWindow({ ...wide, left: { width: 400, collapsed: true } }, 1000)
    // 1000 - 380 - 28 = 592 for the right rail, capped at half the window.
    expect(fitted).toEqual({ left: COLLAPSED_STRIP, right: 500 })
  })

  it('does not rewrite the stored intent', () => {
    usePaneLayout.getState().setWidth('left', 400)
    usePaneLayout.getState().setWidth('right', 600, 2000)
    const stored = usePaneLayout.getState()

    expect(fitToWindow(stored, 800)).toEqual({ left: 180, right: 240 })
    expect(usePaneLayout.getState().left.width).toBe(400)
    expect(usePaneLayout.getState().right.width).toBe(600)
  })
})
