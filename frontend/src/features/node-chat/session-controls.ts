import type { AgentOption, ModeGroup, ModeOption } from '../settings'

/**
 * How each permission group is introduced in the selector. A mode that asks
 * presents each request to the learner, who can let the agent act
 * (acp-agent-permissions); only a request arriving outside any turn is refused.
 */
export const MODE_GROUP_LABELS: Record<ModeGroup, string> = {
  asks: 'Asks before acting',
  edits: "Edits this session's folder without asking",
  unasked: 'Acts on your system without asking',
}

export const MODE_GROUP_HELP: Record<ModeGroup, string> = {
  asks: "The agent asks you before it changes anything or runs a command; reading this session's folder needs no answer.",
  edits: "The agent may edit files in this session's folder without asking.",
  unasked: 'The agent may run commands and change files on your system without asking.',
}

export const MODE_GROUP_ORDER: ModeGroup[] = ['asks', 'edits', 'unasked']

/** A mode's group as the offer gives it; one it does not list is the most permissive. */
export function modeGroupOf(mode: ModeOption, value: string): ModeGroup {
  return mode.values.find((candidate) => candidate.value === value)?.group ?? 'unasked'
}

/**
 * The group of the mode the session is in now: what the running turn
 * reported, else what its last turn ran with, else — before any turn — the
 * mode the learner chose, else the agent's own default.
 */
export function currentModeGroup({
  live,
  recorded,
  chosen,
  mode,
}: {
  live: ModeGroup | null
  recorded: ModeGroup | null
  chosen: string | null
  mode: ModeOption | null
}): ModeGroup | null {
  if (live) return live
  if (recorded) return recorded
  if (!mode) return null
  if (chosen) return modeGroupOf(mode, chosen)
  return mode.current ? modeGroupOf(mode, mode.current) : null
}

const ON = /^(on|true|enabled?|yes|1)$/i
const OFF = /^(off|false|disabled?|no|0)$/i

/**
 * The values a fast-mode switch flips between, when the option is plainly an
 * on/off pair. `null` for anything else, which is then offered as a select.
 */
export function fastSwitch(option: AgentOption): { on: string; off: string } | null {
  if (option.values.length !== 2) return null
  const on = option.values.find((v) => ON.test(v.value))
  const off = option.values.find((v) => OFF.test(v.value))
  return on && off ? { on: on.value, off: off.value } : null
}

/** `17140` → `17k`, `1000000` → `1M`. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count))
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`
  return `${Number((count / 1_000_000).toFixed(1))}M`
}
