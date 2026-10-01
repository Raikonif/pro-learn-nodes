// Public surface for the memory feature.
// Import this feature only via this file; internal paths are private.
export { default as MemoryButton } from './components/MemoryButton'
export { default as MemoryPanel } from './components/MemoryPanel'

import { useMemoryStore } from './memory-store'

export { useMemoryStore }
export type { MemoryState } from './memory-store'
export type { Memory } from './memory-api'

/**
 * Forgets the memory held in this window. Called when the account changes,
 * beside the workspace's own discard: memories are per-learner.
 */
export function discardMemoryState(): void {
  useMemoryStore.getState().discard()
}
