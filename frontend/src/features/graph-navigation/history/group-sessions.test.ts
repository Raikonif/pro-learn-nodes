import { afterEach, describe, expect, it, vi } from 'vitest'

import { groupSessionsByDay } from './group-sessions'

/**
 * Every instant here is built from LOCAL date parts, so the assertions hold in
 * whatever timezone the suite runs in — which is exactly the property under
 * test: grouping follows the learner's calendar, not UTC.
 */
function local(year: number, month: number, day: number, hour = 12, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second)
}

function session(id: string, at: Date) {
  return { id, lastActivityAt: at.toISOString() }
}

// Mid-morning on 30 September.
const NOW = local(2026, 9, 30, 10, 0)

function shape(groups: ReturnType<typeof groupSessionsByDay<{ id: string; lastActivityAt: string }>>) {
  return groups.map((group) => [group.label, group.sessions.map((s) => s.id)])
}

describe('groupSessionsByDay', () => {
  it('puts today, yesterday, four days ago and a month ago in their four groups, in order', () => {
    const groups = groupSessionsByDay(
      [
        session('month', local(2026, 8, 30)),
        session('four-days', local(2026, 9, 26)),
        session('today', local(2026, 9, 30, 9)),
        session('yesterday', local(2026, 9, 29)),
      ],
      NOW,
    )

    expect(shape(groups)).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['four-days']],
      ['Older', ['month']],
    ])
  })

  it('orders each group most recent first', () => {
    const groups = groupSessionsByDay(
      [
        session('early', local(2026, 9, 30, 1)),
        session('late', local(2026, 9, 30, 9, 30)),
        session('middle', local(2026, 9, 30, 5)),
      ],
      NOW,
    )

    expect(shape(groups)).toEqual([['Today', ['late', 'middle', 'early']]])
  })

  it('omits empty groups', () => {
    const groups = groupSessionsByDay([session('old', local(2025, 1, 1))], NOW)

    expect(groups.map((group) => group.key)).toEqual(['older'])
  })

  it('returns no groups for no sessions', () => {
    expect(groupSessionsByDay([], NOW)).toEqual([])
  })

  it('splits today from yesterday at local midnight, not 24 hours back', () => {
    const justAfterMidnight = local(2026, 9, 30, 0, 1)
    const groups = groupSessionsByDay(
      [
        session('first-minute-today', local(2026, 9, 30, 0, 0, 0)),
        session('last-second-yesterday', local(2026, 9, 29, 23, 59, 59)),
      ],
      justAfterMidnight,
    )

    expect(shape(groups)).toEqual([
      ['Today', ['first-minute-today']],
      ['Yesterday', ['last-second-yesterday']],
    ])
  })

  it('splits yesterday from the previous 7 days at the midnight before yesterday', () => {
    const groups = groupSessionsByDay(
      [
        session('start-of-yesterday', local(2026, 9, 29, 0, 0, 0)),
        session('end-of-two-days-ago', local(2026, 9, 28, 23, 59, 59)),
      ],
      NOW,
    )

    expect(shape(groups)).toEqual([
      ['Yesterday', ['start-of-yesterday']],
      ['Previous 7 days', ['end-of-two-days-ago']],
    ])
  })

  it('keeps seven calendar days back in the previous 7 days and moves the eighth to older', () => {
    const groups = groupSessionsByDay(
      [
        session('seven-days-ago-first-second', local(2026, 9, 23, 0, 0, 0)),
        session('eight-days-ago-last-second', local(2026, 9, 22, 23, 59, 59)),
      ],
      NOW,
    )

    expect(shape(groups)).toEqual([
      ['Previous 7 days', ['seven-days-ago-first-second']],
      ['Older', ['eight-days-ago-last-second']],
    ])
  })

  it('counts calendar days across a month boundary', () => {
    const groups = groupSessionsByDay(
      [session('last-of-september', local(2026, 9, 30, 22))],
      local(2026, 10, 1, 8),
    )

    expect(shape(groups)).toEqual([['Yesterday', ['last-of-september']]])
  })

  it('treats activity stamped slightly ahead of the clock as today', () => {
    const groups = groupSessionsByDay([session('skewed', local(2026, 9, 30, 10, 0, 5))], NOW)

    expect(shape(groups)).toEqual([['Today', ['skewed']]])
  })
})

describe('groupSessionsByDay — across a daylight-saving change', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('still counts a 23-hour day as one calendar day', () => {
    // New York springs forward on 8 March 2026: that day has 23 hours.
    vi.stubEnv('TZ', 'America/New_York')
    const now = local(2026, 3, 9, 0, 30)

    const groups = groupSessionsByDay(
      [
        session('yesterday-early', local(2026, 3, 8, 0, 30)),
        session('two-days-ago-late', local(2026, 3, 7, 23, 30)),
      ],
      now,
    )

    expect(shape(groups)).toEqual([
      ['Yesterday', ['yesterday-early']],
      ['Previous 7 days', ['two-days-ago-late']],
    ])
  })
})
