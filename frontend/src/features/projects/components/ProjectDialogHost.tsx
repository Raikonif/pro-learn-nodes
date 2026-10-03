import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { Project } from '../../../shared/lib/workspace-types'
import { useProjectsUi } from '../projects-ui-store'

import DialogShell from './DialogShell'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const BUTTON = 'rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100'
const PRIMARY =
  'rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'
const DANGER =
  'rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50'

/**
 * Mount once in the workspace: every way of asking for a project dialog (the
 * rail's menu, the session header, the palette) opens it from here.
 */
export function ProjectDialogHost() {
  const dialog = useProjectsUi((s) => s.dialog)
  const close = useProjectsUi((s) => s.close)
  const projects = useWorkspaceStore((s) => s.graph.projects)

  if (!dialog) return null
  if (dialog.kind === 'new') return <NameDialog project={null} onClose={close} />

  const project = projects.find((candidate) => candidate.id === dialog.projectId)
  // The project can vanish under an open dialog (an account switch, a
  // snapshot that no longer carries it); there is nothing left to edit.
  if (!project) return null

  switch (dialog.kind) {
    case 'rename':
      return <NameDialog project={project} onClose={close} />
    case 'instructions':
      return <InstructionsDialog project={project} onClose={close} />
    case 'delete':
      return <DeleteDialog project={project} onClose={close} />
  }
}

/** Creates a project, or renames one. An empty name is refused here and by the store. */
function NameDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const createProject = useWorkspaceStore((s) => s.createProject)
  const renameProject = useWorkspaceStore((s) => s.renameProject)
  const [name, setName] = useState(project?.name ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  const ref = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (pending) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('A project name cannot be empty.')
      return
    }
    setPending(true)
    setError(null)
    try {
      if (project) await renameProject(project.id, trimmed)
      else await createProject(trimmed)
      onClose()
    } catch (caught) {
      setError(messageOf(caught))
      setPending(false)
    }
  }

  return (
    <DialogShell
      title={project ? `Rename ${project.name}` : 'New project'}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-xs font-medium text-gray-600">
          Project name
        </label>
        <input
          ref={ref}
          id={nameId}
          type="text"
          value={name}
          aria-invalid={error ? 'true' : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {project ? 'Rename' : 'Create'}
        </button>
      </div>
    </DialogShell>
  )
}

/** Reads and edits a project's instructions: what its sessions' agents are told. */
function InstructionsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const setProjectInstructions = useWorkspaceStore((s) => s.setProjectInstructions)
  const [draft, setDraft] = useState(project.instructions)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      if (draft !== project.instructions) await setProjectInstructions(project.id, draft)
      onClose()
    } catch (caught) {
      setError(messageOf(caught))
      setPending(false)
    }
  }

  return (
    <DialogShell
      title={`Instructions for ${project.name}`}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-xs font-medium text-gray-600">
          Instructions
        </label>
        <textarea
          ref={ref}
          id={fieldId}
          rows={8}
          value={draft}
          placeholder="Anything the agent should know in every session of this project"
          onChange={(event) => setDraft(event.target.value)}
          className="resize-y rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        />
        <p className="text-[11px] text-gray-500">
          The agent receives these when a session in this project starts, and once more after you change them.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={PRIMARY}>
          Save
        </button>
      </div>
    </DialogShell>
  )
}

/** Names the outcome before it happens: the sessions are kept, in the default project. */
function DeleteDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const deleteProject = useWorkspaceStore((s) => s.deleteProject)
  const defaultName = useWorkspaceStore((s) => s.graph.projects.find((p) => p.isDefault)?.name ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm(): Promise<void> {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await deleteProject(project.id)
      onClose()
    } catch (caught) {
      setError(messageOf(caught))
      setPending(false)
    }
  }

  return (
    <DialogShell title={`Delete ${project.name}?`} onClose={onClose}>
      <p className="text-sm text-gray-700">
        The project&apos;s sessions, archived ones included, will move to the default project
        {defaultName ? ` (${defaultName})` : ''}. No session is deleted, and their conversations and links
        are unchanged.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BUTTON}>
          Cancel
        </button>
        <button type="button" disabled={pending} onClick={() => void confirm()} className={DANGER}>
          Delete project
        </button>
      </div>
    </DialogShell>
  )
}

export default ProjectDialogHost
