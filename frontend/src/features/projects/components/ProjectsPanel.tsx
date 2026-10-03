import { useEffect, useId, useState } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { ArchivedProject } from '../../../shared/lib/workspace-api'
import { DEFAULT_PROJECT_REASON } from '../filter-sessions'
import { openDeleteProject, openNewProject, openProjectInstructions, openRenameProject } from '../projects-ui-store'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const MENU_BUTTON = 'rounded px-1 py-0.5 text-left text-xs text-gray-700 hover:bg-gray-100 hover:text-gray-900'

/**
 * The project filter above the session history, and the menu that manages
 * projects.
 *
 * The filter narrows the history on this device and changes nothing else. The
 * menu is inline and collapsed by default, and every dialog it opens overlays
 * the workspace, so managing projects never adds a pane or costs the graph
 * its space. Rename, instructions, archive and delete act on the project the
 * filter is on; with all projects shown there is no "current" one to act on,
 * and the menu says to choose one.
 *
 * The default project is shown with the reason it has no archive or delete,
 * rather than with those controls quietly absent.
 */
function ProjectsPanel() {
  const projects = useWorkspaceStore((s) => s.graph.projects)
  const filter = useWorkspaceStore((s) => s.projectFilter)
  const setFilter = useWorkspaceStore((s) => s.setProjectFilter)
  const archiveProject = useWorkspaceStore((s) => s.archiveProject)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectId = useId()
  const menuId = useId()
  const selected = projects.find((project) => project.id === filter) ?? null

  async function archive(id: string): Promise<void> {
    setError(null)
    try {
      await archiveProject(id)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <div role="group" aria-label="Projects" className="flex flex-col gap-1">
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={selectId} className="text-xs font-medium text-gray-500">
            Project
          </label>
          <select
            id={selectId}
            value={selected?.id ?? ''}
            onChange={(event) => setFilter(event.target.value || null)}
            className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((open) => !open)}
          className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          Manage
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {menuOpen ? (
        <div
          id={menuId}
          role="group"
          aria-label="Manage projects"
          className="flex flex-col gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-1.5"
        >
          <button type="button" onClick={openNewProject} className={MENU_BUTTON}>
            New project…
          </button>
          {selected ? (
            <>
              <button
                type="button"
                aria-label={`Rename project ${selected.name}`}
                onClick={() => openRenameProject(selected.id)}
                className={MENU_BUTTON}
              >
                Rename…
              </button>
              <button
                type="button"
                aria-label={`Edit instructions of ${selected.name}`}
                onClick={() => openProjectInstructions(selected.id)}
                className={MENU_BUTTON}
              >
                Instructions…
              </button>
              {selected.isDefault ? (
                <p data-testid="default-project-reason" className="px-1 pt-1 text-[11px] text-gray-500">
                  {DEFAULT_PROJECT_REASON}
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label={`Archive project ${selected.name}`}
                    onClick={() => void archive(selected.id)}
                    className={MENU_BUTTON}
                  >
                    Archive project
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete project ${selected.name}`}
                    onClick={() => openDeleteProject(selected.id)}
                    className={`${MENU_BUTTON} text-red-700 hover:text-red-800`}
                  >
                    Delete project…
                  </button>
                </>
              )}
            </>
          ) : (
            <p className="px-1 pt-1 text-[11px] text-gray-500">
              Choose a project above to rename it, edit its instructions, archive it or delete it.
            </p>
          )}
          <ArchivedProjects />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Archived projects, each with the number of sessions it holds and Restore.
 *
 * Read when shown and again after anything that changes it. The count of
 * projects in the snapshot is the signal that something was archived or
 * restored elsewhere (the palette, the menu), so the list re-reads on it.
 */
function ArchivedProjects() {
  const fetchArchivedProjects = useWorkspaceStore((s) => s.fetchArchivedProjects)
  const restoreProject = useWorkspaceStore((s) => s.restoreProject)
  const liveProjects = useWorkspaceStore((s) => s.graph.projects.length)
  const [open, setOpen] = useState(false)
  const [archived, setArchived] = useState<ArchivedProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchArchivedProjects().then(
      (projects) => {
        if (!cancelled) {
          setArchived(projects)
          setError(null)
        }
      },
      (caught: unknown) => {
        if (!cancelled) setError(messageOf(caught))
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, liveProjects, fetchArchivedProjects])

  async function restore(id: string): Promise<void> {
    setError(null)
    try {
      await restoreProject(id)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-0.5 border-t border-gray-200 pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={MENU_BUTTON}
      >
        Archived projects
      </button>
      {open ? (
        <div id={listId} className="flex flex-col gap-0.5">
          {error ? (
            <p role="alert" className="px-1 text-[11px] text-red-700">
              {error}
            </p>
          ) : null}
          {archived === null ? (
            error ? null : <p className="px-1 text-[11px] text-gray-400">Loading…</p>
          ) : archived.length === 0 ? (
            <p className="px-1 text-[11px] text-gray-400">No archived projects.</p>
          ) : (
            <ul aria-label="Archived projects" className="flex flex-col gap-0.5">
              {archived.map((project) => (
                <li
                  key={project.id}
                  data-testid="archived-project"
                  className="flex items-center justify-between gap-2 px-1"
                >
                  <span className="min-w-0 truncate text-xs text-gray-700">
                    {project.name}
                    <span className="text-gray-400">
                      {' '}
                      · {project.nodeCount} {project.nodeCount === 1 ? 'session' : 'sessions'}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Restore project ${project.name}`}
                    onClick={() => void restore(project.id)}
                    className="shrink-0 text-[11px] font-medium text-blue-700 hover:underline"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default ProjectsPanel
