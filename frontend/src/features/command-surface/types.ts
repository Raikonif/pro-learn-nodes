/**
 * One thing the learner can ask for by name. The registry is a list of
 * these; every surface that offers commands reads the same list.
 */
export type Command = {
  /** Stable across renders and restarts, unique in the registry: `workspace.new-session`, `session.model:sonnet`, `agent.compact`. */
  id: string
  /** What the learner searches and reads: `New session`, `Model: Sonnet 4.5`, `/compact`. */
  title: string
  /** `Workspace`, `Practice`, `Session`, or the agent's name. */
  group: string
  description?: string
  keywords?: string[]
  /** The reason the command cannot run now. A command is listed with it, never hidden. */
  unavailable?: string
  /** Does nothing observable when `unavailable` is set; callers check it first. */
  run: () => void
}

export const WORKSPACE_GROUP = 'Workspace'
export const PROJECT_GROUP = 'Projects'
export const PRACTICE_GROUP = 'Practice'
export const SESSION_GROUP = 'Session'

/** Why a command that needs an open node is unavailable with none open. */
export const NEEDS_OPEN_SESSION = 'Open a session first.'

/** Why a session command is unavailable before the agent has reported what it offers. */
export const NEEDS_OFFER = 'Send a message first, so the agent reports what it offers.'

/** Why a mode that acts without asking is not set from the palette. */
export const UNASKED_MODE_REASON = 'Acts without asking — choose it in the session controls, where it is confirmed.'
