import { useAgentsStore, useSettingsPanelStore } from '../settings'
import { useMemoryStore } from '../memory'
import { openDetailedStart } from '../study-launcher'
import { usePaneLayout } from '../../shared/lib/pane-layout'
import { useWorkspaceStore } from '../../shared/lib/workspace-store'

import { WORKSPACE_GROUP, type Command } from './types'

/**
 * The workspace's own actions: starting sessions, the two rails, the agents
 * panel and memory. Each calls what its button calls.
 */
export function useWorkspaceCommands(): Command[] {
  const createRootNode = useWorkspaceStore((s) => s.createRootNode)
  const leftCollapsed = usePaneLayout((s) => s.left.collapsed)
  const rightCollapsed = usePaneLayout((s) => s.right.collapsed)
  const openAgents = useAgentsStore((s) => s.openPanel)
  const openMemory = useMemoryStore((s) => s.openPanel)
  const openSettings = useSettingsPanelStore((s) => s.openPanel)

  return [
    {
      id: 'workspace.new-session',
      title: 'New session',
      group: WORKSPACE_GROUP,
      description: 'Start a session at once, titled from its first message',
      keywords: ['start', 'create', 'chat'],
      // Exactly what the New session button does. It shows a failure beside
      // itself; the palette has closed by then, so there is nowhere to show
      // one, and the rejection is dropped rather than left unhandled.
      run: () => void Promise.resolve(createRootNode()).catch(() => undefined),
    },
    {
      id: 'workspace.start-with-topic',
      title: 'Start with a topic…',
      group: WORKSPACE_GROUP,
      description: 'Start a session with a topic and a learning mode',
      keywords: ['new', 'session', 'mode'],
      run: openDetailedStart,
    },
    {
      id: 'workspace.toggle-node-index',
      title: leftCollapsed ? 'Expand node index' : 'Collapse node index',
      group: WORKSPACE_GROUP,
      description: 'The left rail',
      keywords: ['left', 'rail', 'sidebar', 'sessions'],
      run: () => usePaneLayout.getState().toggleCollapsed('left'),
    },
    {
      id: 'workspace.toggle-workspace-tools',
      title: rightCollapsed ? 'Expand workspace tools' : 'Collapse workspace tools',
      group: WORKSPACE_GROUP,
      description: 'The right rail',
      keywords: ['right', 'rail', 'sidebar', 'practice'],
      run: () => usePaneLayout.getState().toggleCollapsed('right'),
    },
    {
      id: 'workspace.agents',
      title: 'Agent settings',
      group: WORKSPACE_GROUP,
      description: 'Register and choose the agents sessions run on',
      keywords: ['agents', 'providers', 'codex', 'claude'],
      run: openAgents,
    },
    {
      id: 'workspace.memory',
      title: 'Memory',
      group: WORKSPACE_GROUP,
      description: 'What Learn Nodes remembers about you',
      keywords: ['remember', 'memories'],
      run: openMemory,
    },
    {
      id: 'workspace.settings',
      title: 'Settings',
      group: WORKSPACE_GROUP,
      description: 'Where Learn Nodes keeps your data',
      keywords: ['preferences', 'data', 'location', 'folder', 'storage', 'move'],
      run: openSettings,
    },
  ]
}
