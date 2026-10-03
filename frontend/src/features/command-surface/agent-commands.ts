import { PRACTICE_COMMANDS, placeInComposer, useSessionOffer } from '../node-chat'

import type { Command } from './types'

/**
 * The commands and skills the open node's agent last announced, under the
 * agent's name and described as it describes them. A newly announced one
 * appears with no change here. Names Learn Nodes reserves are left out — the
 * composer's menu makes the same cut, because sending one would run Learn
 * Nodes' command, not the agent's. Each is placed in the composer, never sent.
 */
export function useAgentCommands(openNodeId: string | null): Command[] {
  const offer = useSessionOffer(openNodeId)
  if (!offer || !offer.known) return []

  const reserved = new Set<string>(PRACTICE_COMMANDS.map((command) => command.name))
  const seen = new Set<string>()
  const commands: Command[] = []
  for (const command of offer.commands) {
    if (reserved.has(command.name) || seen.has(command.name)) continue
    seen.add(command.name)
    commands.push({
      id: `agent.${command.name}`,
      title: `/${command.name}`,
      group: offer.agentName,
      description: command.description ?? undefined,
      keywords: command.inputHint ? [command.inputHint] : undefined,
      run: () => placeInComposer(`/${command.name} `),
    })
  }
  return commands
}
