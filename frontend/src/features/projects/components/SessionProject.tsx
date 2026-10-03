import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { openProjectInstructions } from '../projects-ui-store'

/**
 * The project a session belongs to, in its header; activating it opens the
 * project's instructions.
 *
 * Naming it matters because the project is what decides which instructions the
 * session's agent has, and a link from another project's session says nothing
 * about that. Renders nothing for a session whose project is not known.
 */
function SessionProject({ projectId }: { projectId: string | null }) {
  const project = useWorkspaceStore((s) => s.graph.projects.find((candidate) => candidate.id === projectId))
  if (!project) return null

  return (
    <button
      type="button"
      data-testid="session-project-link"
      aria-label={`Project ${project.name}: show instructions`}
      onClick={() => openProjectInstructions(project.id)}
      className="max-w-[12rem] truncate rounded-full border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 hover:border-blue-500 hover:text-blue-700"
    >
      {project.name}
    </button>
  )
}

export default SessionProject
