import { openNewProject } from '../projects'
import { useWorkspaceStore } from '../../shared/lib/workspace-store'

import { NEEDS_OPEN_SESSION, PROJECT_GROUP, type Command } from './types'

/**
 * Projects from the palette: show one, show all, start a new one, and move the
 * open session into one.
 *
 * The projects come from the snapshot, which carries only unarchived ones, so
 * an archived project is simply absent here as it is from the filter and the
 * move menu. Showing a project sets the same device filter the rail's select
 * does. Moving needs an open session, and is listed with that reason, never
 * hidden, when there is none.
 */
export function useProjectCommands(openNodeId: string | null): Command[] {
  const projects = useWorkspaceStore((s) => s.graph.projects)
  const filter = useWorkspaceStore((s) => s.projectFilter)
  const openProjectId = useWorkspaceStore((s) =>
    openNodeId ? (s.graph.nodes.find((node) => node.id === openNodeId)?.projectId ?? null) : null,
  )

  const show: Command[] = projects.map((project) => ({
    id: `projects.show:${project.id}`,
    title: `Show project: ${project.name}`,
    group: PROJECT_GROUP,
    description: project.id === filter ? 'Showing now' : 'Narrow the session history to this project',
    keywords: ['filter', 'project', project.name],
    run: () => useWorkspaceStore.getState().setProjectFilter(project.id),
  }))

  const move: Command[] = projects.map((project) => ({
    id: `projects.move:${project.id}`,
    title: `Move session to ${project.name}`,
    group: PROJECT_GROUP,
    description: project.id === openProjectId ? 'Already in this project' : undefined,
    keywords: ['project', 'assign', project.name],
    unavailable: openNodeId === null ? NEEDS_OPEN_SESSION : undefined,
    // The rail shows a refusal beside the control; the palette has closed by
    // then, so a rejection is dropped and the session simply stays where it was.
    run: () => {
      if (openNodeId === null) return
      void useWorkspaceStore
        .getState()
        .moveNodeToProject(openNodeId, project.id)
        .catch(() => undefined)
    },
  }))

  return [
    {
      id: 'projects.show-all',
      title: 'Show all projects',
      group: PROJECT_GROUP,
      description: filter === null ? 'Showing now' : 'Clear the project filter',
      keywords: ['filter', 'everything'],
      run: () => useWorkspaceStore.getState().setProjectFilter(null),
    },
    ...show,
    {
      id: 'projects.new',
      title: 'New project',
      group: PROJECT_GROUP,
      description: 'Group sessions, with instructions for their agents',
      keywords: ['create', 'folder'],
      run: openNewProject,
    },
    ...move,
  ]
}
