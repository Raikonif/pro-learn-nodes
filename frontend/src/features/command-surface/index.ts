// Public surface for the command-surface feature.
// Import this feature only via this file; internal paths are private.
export { useCommands } from './registry'
export { default as CommandPalette } from './Palette'
export { match } from './match'
export type { Command } from './types'
export type { MatchResult, PaletteNode, Page } from './match'
