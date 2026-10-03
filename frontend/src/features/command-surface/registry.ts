import { useWorkspaceStore } from '../../shared/lib/workspace-store'

import { useAgentCommands } from './agent-commands'
import { usePracticeCommands } from './practice-commands'
import { useProjectCommands } from './project-commands'
import { useSessionCommands } from './session-commands'
import type { Command } from './types'
import { useWorkspaceCommands } from './workspace-commands'

/**
 * Every command the learner can run now or could with something more, in the
 * order the empty palette shows them: Workspace, Projects, Practice, Session,
 * then the agent's. A function of state: it follows the open node, the rails and what
 * the agent last announced. A new contributor is one more hook here.
 */
export function useCommands(): Command[] {
  const openNodeId = useWorkspaceStore((s) => s.openNodeId)
  const workspace = useWorkspaceCommands()
  const projects = useProjectCommands(openNodeId)
  const practice = usePracticeCommands(openNodeId)
  const session = useSessionCommands(openNodeId)
  const agent = useAgentCommands(openNodeId)
  return [...workspace, ...projects, ...practice, ...session, ...agent]
}
