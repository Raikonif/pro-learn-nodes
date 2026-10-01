import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAgentsStore } from '../../settings'
import { searchSessions, type SessionSearchResult } from '../../../shared/lib/workspace-api'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { groupSessionsByDay } from '../history/group-sessions'
import { latestMessageByNode, previewText } from '../history/session-preview'

import SessionHistoryEntry from './SessionHistoryEntry'
import SessionSearchResults from './SessionSearchResults'

/** How long typing must pause before the index is asked. */
export const SEARCH_DEBOUNCE_MS = 250

export type RecentsRailProps = {
  /**
   * A control for the header — the workspace puts the quick start here.
   * Passed in rather than imported so the history does not depend on how
   * sessions are created.
   */
  headerAction?: ReactNode
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; results: SessionSearchResult[] }
  | { status: 'error'; message: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Left rail: the session history.
 *
 * Sessions (nodes) by last activity, grouped by the learner's local day, each
 * previewing where it left off and the agent it ran on. Typing searches titles
 * and message content through the backend's index; an empty query shows the
 * history again.
 *
 * Nodes only — never threads. A thread lives inside its node's conversation
 * and has no meaning outside it, so listing threads here would turn the rail
 * into a flat chat history and quietly replace the graph as the way people
 * navigate. That is the failure mode the spec forbids. The graph stays the
 * navigation; this is its index.
 */
function RecentsRail({ headerAction }: RecentsRailProps) {
  const graph = useWorkspaceStore((s) => s.graph)
  const openNodeId = useWorkspaceStore((s) => s.openNodeId)
  const searchTerm = useWorkspaceStore((s) => s.searchTerm)
  const setSearchTerm = useWorkspaceStore((s) => s.setSearchTerm)
  const openNode = useWorkspaceStore((s) => s.openNode)
  const openSessionAt = useWorkspaceStore((s) => s.openSessionAt)
  const renameNode = useWorkspaceStore((s) => s.renameNode)
  const archiveNode = useWorkspaceStore((s) => s.archiveNode)
  const restoreNode = useWorkspaceStore((s) => s.restoreNode)
  const agents = useAgentsStore((s) => s.agents)
  const agentsStatus = useAgentsStore((s) => s.status)
  const loadAgents = useAgentsStore((s) => s.load)

  const [includeArchived, setIncludeArchived] = useState(false)
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  // Bumped to re-ask the index for the same query, after a restore changed
  // what it would answer.
  const [searchRevision, setSearchRevision] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const query = searchTerm.trim()

  useEffect(() => {
    if (agentsStatus === 'idle') void loadAgents()
  }, [agentsStatus, loadAgents])

  useEffect(() => {
    if (!query) {
      setSearch({ status: 'idle' })
      return
    }
    let cancelled = false
    setSearch({ status: 'loading' })
    const timer = setTimeout(() => {
      searchSessions(query, { includeArchived }).then(
        (results) => {
          if (!cancelled) setSearch({ status: 'ready', results })
        },
        (error: unknown) => {
          if (!cancelled) setSearch({ status: 'error', message: messageOf(error) })
        },
      )
    }, SEARCH_DEBOUNCE_MS)
    // A newer query supersedes this one, including a response already in
    // flight: an older answer must never land over a newer question.
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, includeArchived, searchRevision])

  // Grouping orders each group most recent first, so the nodes go in as they are.
  const groups = useMemo(() => groupSessionsByDay(graph.nodes, new Date()), [graph])
  const latest = useMemo(() => latestMessageByNode(graph), [graph])
  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])

  async function run(action: () => void | Promise<void>): Promise<void> {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(messageOf(error))
    }
  }

  function openResult(result: SessionSearchResult): void {
    void run(() => openSessionAt(result.nodeId, result.threadId, result.messageId))
  }

  function restoreResult(result: SessionSearchResult): void {
    void run(async () => {
      await restoreNode(result.nodeId)
      setSearchRevision((revision) => revision + 1)
    })
  }

  return (
    <nav aria-label="Session history" className="flex h-full w-full min-w-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sessions</h2>
        {headerAction}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="recents-search" className="text-xs font-medium text-gray-500">
          Search sessions
        </label>
        <input
          id="recents-search"
          type="search"
          value={searchTerm}
          placeholder="Titles and messages"
          onChange={(event) => setSearchTerm(event.target.value)}
          className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        />
        {query ? (
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            Include archived
          </label>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="text-xs text-red-700">
          {actionError}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {query ? (
          search.status === 'ready' ? (
            search.results.length === 0 ? (
              <p className="text-xs text-gray-400">No sessions match.</p>
            ) : (
              <SessionSearchResults
                results={search.results}
                onOpen={openResult}
                onRestore={restoreResult}
              />
            )
          ) : search.status === 'error' ? (
            <p role="alert" className="text-xs text-red-700">
              Search failed: {search.message}
            </p>
          ) : (
            <p className="text-xs text-gray-400">Searching…</p>
          )
        ) : groups.length === 0 ? (
          <p className="text-xs text-gray-400">No sessions yet.</p>
        ) : (
          groups.map((group) => (
            <section key={group.key} aria-label={group.label} className="flex flex-col gap-1">
              <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {group.label}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.sessions.map((node) => {
                  const message = latest.get(node.id)
                  return (
                    <SessionHistoryEntry
                      key={node.id}
                      node={node}
                      current={node.id === openNodeId}
                      preview={message ? previewText(message.content) : null}
                      agentName={
                        node.backendAgentId ? (agentNames.get(node.backendAgentId) ?? null) : null
                      }
                      onOpen={() => void run(() => openNode(node.id))}
                      onRename={(title) => renameNode(node.id, title)}
                      onArchive={() => run(() => archiveNode(node.id))}
                    />
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  )
}

export default RecentsRail
