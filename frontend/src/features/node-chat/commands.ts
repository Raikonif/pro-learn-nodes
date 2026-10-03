import type { TurnCommand } from './chat-api'

/**
 * The composer's practice commands. Fixed here (design.md "Commands are an
 * instruction the application adds"); a later, general `/` menu should adopt
 * these rather than redefine them.
 */
export const PRACTICE_COMMANDS: { name: TurnCommand; description: string }[] = [
  { name: 'code', description: 'a code exercise, sent to Code' },
  { name: 'qa', description: 'questions to answer, sent to Q&A' },
  { name: 'quiz', description: 'multiple-choice questions, sent to Quiz' },
]

export type ParsedCommand = { command: TurnCommand; request: string }

/**
 * Reads a message that begins with a practice command. `request` is what the
 * learner asked for after it, possibly empty. Anything else — `/quizzes`, an
 * unknown `/word`, a slash later in the text — is not a command.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const match = /^\/(code|qa|quiz)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return null
  return { command: match[1] as TurnCommand, request: (match[2] ?? '').trim() }
}

/**
 * The commands to suggest while the learner is typing the command word
 * itself (a `/` and letters, nothing after); none once a space follows it.
 */
export function suggestCommands(draft: string): typeof PRACTICE_COMMANDS {
  const match = /^\/(\w*)$/.exec(draft)
  if (!match) return []
  const typed = match[1].toLowerCase()
  return PRACTICE_COMMANDS.filter((command) => command.name.startsWith(typed))
}

/** One entry of the composer's `/` menu, and where it comes from. */
export type MenuCommand = {
  source: 'app' | 'agent'
  /** Without the leading `/`; an agent's is kept exactly as announced (`$archify`). */
  name: string
  description: string | null
}

export type MenuGroup = { source: 'app' | 'agent'; label: string; commands: MenuCommand[] }

/** The agent whose commands the menu offers, as it last announced them. */
export type MenuAgent = { name: string; commands: { name: string; description: string | null }[] }

/** The heading Learn Nodes' own commands are listed under. */
export const APP_COMMANDS_LABEL = 'Learn Nodes'

function matches(name: string, typed: string): boolean {
  const lower = name.toLowerCase()
  // A skill announced as `$archify` is also found by typing `/arch`.
  return lower.startsWith(typed) || (lower.startsWith('$') && lower.slice(1).startsWith(typed))
}

/**
 * The `/` menu while the learner is typing the command word: Learn Nodes'
 * commands, then the agent's, each under its own heading, narrowed by what
 * has been typed. Empty groups are left out; nothing is offered once a space
 * follows the word. An agent command sharing a name with one of Learn Nodes'
 * is left out — sending it would run Learn Nodes' command, not the agent's.
 */
export function suggestMenu(draft: string, agent: MenuAgent | null): MenuGroup[] {
  const match = /^\/(\S*)$/.exec(draft)
  if (!match) return []
  const typed = match[1].toLowerCase()
  const groups: MenuGroup[] = []
  const own = PRACTICE_COMMANDS.filter((command) => matches(command.name, typed))
  if (own.length > 0) {
    groups.push({
      source: 'app',
      label: APP_COMMANDS_LABEL,
      commands: own.map((command) => ({ source: 'app', name: command.name, description: command.description })),
    })
  }
  if (agent) {
    const reserved = new Set<string>(PRACTICE_COMMANDS.map((command) => command.name))
    const theirs = agent.commands.filter((command) => !reserved.has(command.name) && matches(command.name, typed))
    if (theirs.length > 0) {
      groups.push({
        source: 'agent',
        label: agent.name,
        commands: theirs.map((command) => ({ source: 'agent', name: command.name, description: command.description })),
      })
    }
  }
  return groups
}
