import { placeInComposer } from '../node-chat'
import { openPracticeBlock, practiceAddCommands } from '../practice'

import { NEEDS_OPEN_SESSION, PRACTICE_GROUP, type Command } from './types'

/**
 * The workbench's add control, as commands: writing one's own (a block opened)
 * and asking the agent (the command placed in the composer, never sent).
 * Both need an open node — the block belongs to one, the composer is its.
 */
export function usePracticeCommands(openNodeId: string | null): Command[] {
  const unavailable = openNodeId === null ? NEEDS_OPEN_SESSION : undefined

  return practiceAddCommands.flatMap(({ kind, write, ask }): Command[] => [
    {
      id: `practice.write-${kind}`,
      title: write.label,
      group: PRACTICE_GROUP,
      keywords: ['practice', 'workbench', kind],
      unavailable,
      run: () => {
        if (openNodeId !== null) openPracticeBlock(openNodeId, write.block, { author: write.author })
      },
    },
    {
      id: `practice.ask-${kind}`,
      title: ask.label,
      group: PRACTICE_GROUP,
      description: `Places ${ask.command.trim()} in the composer`,
      keywords: ['practice', ask.command.trim(), kind],
      unavailable,
      run: () => placeInComposer(ask.command),
    },
  ])
}
