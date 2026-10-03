import { useId, useState, type KeyboardEvent } from 'react'

import type { WorkspaceNode } from '../../../shared/lib/workspace-types'
import { MoveToProject, ProjectChip } from '../../projects'

export type SessionHistoryEntryProps = {
  node: WorkspaceNode
  /** Name the session's project: while every project is listed, an entry says which it is in. */
  showProject?: boolean
  current: boolean
  /** The beginning of the session's most recent message, if it has one. */
  preview: string | null
  /** The agent the session last ran on, if it is known and still registered. */
  agentName: string | null
  onOpen: () => void
  onRename: (title: string) => void | Promise<void>
  onArchive: () => void | Promise<void>
}

/**
 * One session in the history: its title, a preview of where it left off, the
 * agent it ran on, and what the history lets you do to it — rename, archive,
 * and move it to another project. Never delete: the history retires sessions,
 * it does not lose them.
 *
 * The open button is named by the title alone (`aria-label`) so the preview
 * and agent read as its description rather than as part of its name.
 */
function SessionHistoryEntry({
  node,
  showProject = false,
  current,
  preview,
  agentName,
  onOpen,
  onRename,
  onArchive,
}: SessionHistoryEntryProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.title)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const detailsId = useId()

  function startRename(): void {
    setDraft(node.title)
    setError(null)
    setEditing(true)
  }

  function cancelRename(): void {
    setEditing(false)
    setError(null)
  }

  async function saveRename(): Promise<void> {
    const title = draft.trim()
    if (!title) {
      setError('A title cannot be empty.')
      return
    }
    if (title === node.title) {
      cancelRename()
      return
    }
    setSaving(true)
    try {
      await onRename(title)
      setEditing(false)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      void saveRename()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // Escape here ends the rename and nothing else — not a dialog behind it.
      event.stopPropagation()
      cancelRename()
    }
  }

  const hasDetails = preview !== null || agentName !== null || (showProject && node.projectId !== null)

  return (
    <li
      data-testid="session-entry"
      className={`group flex flex-col rounded-md ${current ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
    >
      {editing ? (
        <div className="flex flex-col gap-1 px-2 py-1">
          <input
            // Focus moves into the field the learner just asked to edit.
            autoFocus
            type="text"
            aria-label={`Rename ${node.title}`}
            aria-invalid={error ? 'true' : undefined}
            value={draft}
            disabled={saving}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={onKeyDown}
            // Leaving the field abandons the rename; only Enter saves.
            onBlur={() => {
              if (!saving) cancelRename()
            }}
            className="min-w-0 rounded border border-blue-500 bg-white px-1 py-0.5 text-sm text-gray-900 focus:outline-none"
          />
          {error ? (
            <p role="alert" className="text-[11px] text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          aria-label={node.title}
          aria-describedby={hasDetails ? detailsId : undefined}
          aria-current={current ? 'true' : undefined}
          onClick={onOpen}
          onDoubleClick={startRename}
          className="flex min-w-0 flex-col px-2 pt-1 text-left"
        >
          <span
            className={`truncate text-sm ${current ? 'font-semibold text-blue-900' : 'text-gray-800'}`}
          >
            {node.title}
          </span>
          {hasDetails ? (
            <span id={detailsId} className="flex min-w-0 flex-col">
              {preview !== null ? (
                <span data-testid="session-preview" className="truncate text-xs text-gray-500">
                  {preview}
                </span>
              ) : null}
              {showProject ? <ProjectChip projectId={node.projectId} /> : null}
              {agentName !== null ? (
                <span data-testid="session-agent" className="truncate text-[11px] text-gray-400">
                  {agentName}
                </span>
              ) : null}
            </span>
          ) : null}
        </button>
      )}

      {!editing ? (
        <div className="flex flex-wrap gap-x-2 px-2 pb-1 text-[11px] text-gray-500">
          <button
            type="button"
            aria-label={`Rename ${node.title}`}
            onClick={startRename}
            className="hover:text-gray-900 hover:underline"
          >
            Rename
          </button>
          <button
            type="button"
            aria-label={`Archive ${node.title}`}
            onClick={() => void onArchive()}
            className="hover:text-gray-900 hover:underline"
          >
            Archive
          </button>
          <MoveToProject
            nodeId={node.id}
            nodeTitle={node.title}
            currentProjectId={node.projectId}
            className="hover:text-gray-900 hover:underline"
          />
        </div>
      ) : null}
    </li>
  )
}

export default SessionHistoryEntry
