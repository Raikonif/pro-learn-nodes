import { describe, expect, it } from 'vitest'

import type { ModeOption } from '../settings'

import { currentModeGroup, fastSwitch, formatTokens, modeGroupOf } from './session-controls'

const MODE: ModeOption = {
  id: 'mode',
  name: 'Mode',
  current: 'auto',
  values: [
    { value: 'default', name: 'Default', description: null, group: 'asks' },
    { value: 'acceptEdits', name: 'Accept edits', description: null, group: 'edits' },
    { value: 'auto', name: 'Auto', description: null, group: 'unasked' },
  ],
}

describe('modeGroupOf', () => {
  it('reads the group the agent\'s offer gives a mode', () => {
    expect(modeGroupOf(MODE, 'default')).toBe('asks')
    expect(modeGroupOf(MODE, 'acceptEdits')).toBe('edits')
  })

  it('puts a mode the offer does not list in the most permissive group', () => {
    expect(modeGroupOf(MODE, 'mystery')).toBe('unasked')
  })
})

describe('currentModeGroup', () => {
  const base = { live: null, recorded: null, chosen: null, mode: MODE }

  it('follows what the running turn reported first', () => {
    expect(currentModeGroup({ ...base, live: 'asks', recorded: 'unasked', chosen: 'auto' })).toBe('asks')
  })

  it('falls back to what the last turn ran with', () => {
    expect(currentModeGroup({ ...base, recorded: 'edits', chosen: 'auto' })).toBe('edits')
  })

  it('falls back to the chosen mode, then to the agent\'s own default', () => {
    expect(currentModeGroup({ ...base, chosen: 'default' })).toBe('asks')
    expect(currentModeGroup(base)).toBe('unasked')
  })

  it('knows nothing without a state, a choice, or an offer', () => {
    expect(currentModeGroup({ ...base, mode: null })).toBeNull()
    expect(currentModeGroup({ ...base, mode: { ...MODE, current: null } })).toBeNull()
  })
})

describe('fastSwitch', () => {
  const option = (values: string[]) => ({
    id: 'fast',
    name: 'Fast',
    current: values[1] ?? null,
    values: values.map((value) => ({ value, name: value, description: null })),
  })

  it('finds the on and off values of a two-valued option', () => {
    expect(fastSwitch(option(['on', 'off']))).toEqual({ on: 'on', off: 'off' })
    expect(fastSwitch(option(['false', 'true']))).toEqual({ on: 'true', off: 'false' })
    expect(fastSwitch(option(['disabled', 'enabled']))).toEqual({ on: 'enabled', off: 'disabled' })
  })

  it('gives up on values it cannot read as on and off', () => {
    expect(fastSwitch(option(['turbo', 'normal', 'slow']))).toBeNull()
    expect(fastSwitch(option(['fast', 'faster']))).toBeNull()
  })
})

describe('formatTokens', () => {
  it('shortens token counts for the header', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(17140)).toBe('17k')
    expect(formatTokens(258400)).toBe('258k')
    expect(formatTokens(1000000)).toBe('1M')
    expect(formatTokens(1500000)).toBe('1.5M')
  })
})
