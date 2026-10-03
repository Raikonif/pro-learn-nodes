// Public surface for the node-chat feature.
// Import this feature only via this file; internal paths are private.
export { default as NodeConversation } from './components/NodeConversation'
export { default as ThreadList } from './components/ThreadList'
export { default as ThreadStub } from './components/ThreadStub'
export { default as ThreadBackLink } from './components/ThreadBackLink'
export { default as SelectionAffordance } from './components/SelectionAffordance'
export { useTextSelection, readSelectionFromDom } from './hooks/use-text-selection'
export type { MessageSelection } from './hooks/use-text-selection'
export { placeInComposer } from './composer-request'
export { PRACTICE_COMMANDS } from './commands'
export { useSessionOffer } from './hooks/use-session-offer'
export type { SessionOfferView } from './hooks/use-session-offer'
export { modeGroupOf, fastSwitch } from './session-controls'
