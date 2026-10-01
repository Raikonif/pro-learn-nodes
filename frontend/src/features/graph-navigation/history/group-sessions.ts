/**
 * Groups sessions for the history rail by the learner's LOCAL calendar date of
 * last activity.
 *
 * The backend stores UTC and cannot know what "yesterday" means to the person
 * looking, so the grouping happens here, against `now` in the runtime's
 * timezone. Counting whole calendar days — not 24-hour spans — is the point:
 * something done at 23:59 yesterday is "Yesterday" at 00:01 today.
 */

export type SessionGroupKey = 'today' | 'yesterday' | 'previous7Days' | 'older'

export type SessionGroup<T> = {
  key: SessionGroupKey
  label: string
  sessions: T[]
}

const GROUPS: ReadonlyArray<{ key: SessionGroupKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'previous7Days', label: 'Previous 7 days' },
  { key: 'older', label: 'Older' },
]

const DAY_MS = 24 * 60 * 60 * 1000

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Whole local calendar days between the two instants. Rounded because a day
 * containing a daylight-saving change is 23 or 25 hours long.
 */
function calendarDaysBetween(earlier: Date, later: Date): number {
  return Math.round((localMidnight(later).getTime() - localMidnight(earlier).getTime()) / DAY_MS)
}

function groupFor(daysAgo: number): SessionGroupKey {
  // A timestamp ahead of the clock (skew between processes) is still "now".
  if (daysAgo <= 0) return 'today'
  if (daysAgo === 1) return 'yesterday'
  if (daysAgo <= 7) return 'previous7Days'
  return 'older'
}

/**
 * Ordered groups — Today, Yesterday, Previous 7 days, Older — each most recent
 * first. A group with no sessions is left out rather than shown empty.
 */
export function groupSessionsByDay<T extends { lastActivityAt: string }>(
  sessions: readonly T[],
  now: Date,
): SessionGroup<T>[] {
  const buckets = new Map<SessionGroupKey, T[]>(GROUPS.map(({ key }) => [key, []]))
  const sorted = [...sessions].sort(
    (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
  )
  for (const session of sorted) {
    buckets.get(groupFor(calendarDaysBetween(new Date(session.lastActivityAt), now)))!.push(session)
  }
  return GROUPS.map(({ key, label }) => ({ key, label, sessions: buckets.get(key)! })).filter(
    (group) => group.sessions.length > 0,
  )
}
