import { useWorkspaceStore } from '../../../shared/lib/workspace-store'

/** A session's project as a quiet line of text, for lists that show every project. */
function ProjectChip({ projectId }: { projectId: string | null }) {
  const name = useWorkspaceStore((s) => s.graph.projects.find((project) => project.id === projectId)?.name)
  if (!name) return null

  return (
    <span data-testid="session-project" className="truncate text-[11px] font-medium text-gray-500">
      {name}
    </span>
  )
}

export default ProjectChip
