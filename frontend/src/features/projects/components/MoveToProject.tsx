import { useId, useState } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'

export type MoveToProjectProps = {
  nodeId: string
  nodeTitle: string
  /** The project the session is in now; it is not offered as a destination. */
  currentProjectId: string | null
  /** Styles the trigger, so the host list can make it match its other actions. */
  className?: string
}

/**
 * "Move to project…": a menu of the unarchived projects a session can go to.
 *
 * Only unarchived projects are listed (the snapshot carries no other), and the
 * session's own project is left out. A move changes membership alone, so the
 * session keeps its conversations and links.
 */
function MoveToProject({ nodeId, nodeTitle, currentProjectId, className }: MoveToProjectProps) {
  const projects = useWorkspaceStore((s) => s.graph.projects)
  const moveNodeToProject = useWorkspaceStore((s) => s.moveNodeToProject)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuId = useId()
  const targets = projects.filter((project) => project.id !== currentProjectId)

  if (targets.length === 0) return null

  async function move(projectId: string): Promise<void> {
    setError(null)
    try {
      await moveNodeToProject(nodeId, projectId)
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Move ${nodeTitle} to a project`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className={className}
      >
        Move to project…
      </button>
      {open ? (
        <div id={menuId} role="group" aria-label={`Move ${nodeTitle} to`} className="flex basis-full flex-col">
          {targets.map((project) => (
            <button
              key={project.id}
              type="button"
              aria-label={`Move ${nodeTitle} to ${project.name}`}
              onClick={() => void move(project.id)}
              className="truncate rounded px-1 text-left text-[11px] text-gray-700 hover:bg-gray-200"
            >
              {project.name}
            </button>
          ))}
          {error ? (
            <p role="alert" className="text-[11px] text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export default MoveToProject
