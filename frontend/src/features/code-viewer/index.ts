// Public surface for the code-viewer feature.
// Import this feature only via this file; internal paths are private.
export { default as CodeView } from './components/CodeView'
export { default as NodeCenterTabs } from './components/NodeCenterTabs'
export { MessageText, OpenInCodeActions } from './components/MessageText'
export type { ExerciseCode } from './code-sources'
export { languageOf, languageOfPath, type LanguageId } from './languages'

import { useCodeViewerStore } from './code-viewer-store'

/**
 * Forgets every node's listed files and read contents. Called when the account
 * changes, alongside the other features' discards, so nothing read for one
 * account stays in the window for the next.
 */
export function discardCodeViewerState(): void {
  useCodeViewerStore.getState().discard()
}
