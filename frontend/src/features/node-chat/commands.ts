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
