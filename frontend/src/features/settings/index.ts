// Public surface for the settings feature.
// Import this feature only via this file; internal paths are private.
export { default as AgentSettingsButton } from './components/AgentSettingsButton'
export { default as AgentSettingsPanel } from './components/AgentSettingsPanel'
export { selectDefaultAgent, useAgentsStore } from './agents-store'
export type { AgentsState, OfferState } from './agents-store'
export type {
  Agent,
  AgentCommand,
  AgentOffer,
  AgentOption,
  AgentOptionValue,
  AgentPreset,
  ConnectionTest,
  ModeGroup,
  ModeOption,
} from './agents-api'
