// Public surface for the practice feature.
// Import this feature only via this file; internal paths are private.
export { default as PracticeRail } from './components/PracticeRail'

import { usePracticeStore, type DeliveredTool, type PracticeReveal } from './practice-store'

/**
 * Forgets every node's practice material and unsaved buffers held in memory.
 * Called when the account changes, alongside the workspace's own discard, so
 * nothing loaded for one account is kept in the window for the next.
 */
export function discardPracticeState(): void {
  usePracticeStore.getState().discard()
}

export type { DeliveredTool, PracticeReveal } from './practice-store'

/**
 * Brings delivered practice into view: re-reads the node's material, selects
 * the tool it belongs to (`code` → Code, `qa` → Q&A, `quiz` → Quiz), opens a
 * delivered code exercise, and highlights the items for a few seconds. The
 * caller decides whether the node is the one on screen.
 */
export function revealPractice(reveal: PracticeReveal): void {
  usePracticeStore.getState().reveal(reveal)
}

const TOOL_LABELS: Record<DeliveredTool, string> = { code: 'Code', qa: 'Q&A', quiz: 'Quiz' }

/** The tab name a delivered tool appears under, for text that leads there. */
export function practiceToolLabel(tool: DeliveredTool): string {
  return TOOL_LABELS[tool]
}
