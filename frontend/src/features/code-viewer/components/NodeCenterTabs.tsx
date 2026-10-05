import { useEffect, useRef, type ReactNode } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { useCodeViewerStore } from '../code-viewer-store'
import { useCodeSources, type ExerciseCode } from '../code-sources'
import CodeTab from './CodeTab'

const TAB =
  'rounded-t px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

/**
 * An open node's center region: its conversation and, when the node has code,
 * a Code tab beside it. The conversation stays mounted while Code is shown, so
 * a turn keeps streaming into it; its tab says when one is running. The tabs
 * add no pane — they switch what this region shows.
 */
function NodeCenterTabs({
  conversation,
  turnRunning,
  exercises,
}: {
  conversation: ReactNode
  turnRunning: boolean
  /** The open node's code exercises, from practice. */
  exercises: ExerciseCode[]
}) {
  const nodeId = useWorkspaceStore((s) => s.openNodeId)
  const chosen = useCodeViewerStore((s) => s.tab)
  const showTab = useCodeViewerStore((s) => s.showTab)
  const refreshFiles = useCodeViewerStore((s) => s.refreshFiles)
  const sources = useCodeSources(nodeId, exercises)

  // The node's folder is read when the node opens, and again after each turn:
  // a turn is when an agent writes files.
  useEffect(() => {
    if (nodeId) void refreshFiles(nodeId)
  }, [nodeId, refreshFiles])
  const wasRunning = useRef(turnRunning)
  useEffect(() => {
    if (wasRunning.current && !turnRunning && nodeId) void refreshFiles(nodeId)
    wasRunning.current = turnRunning
  }, [turnRunning, nodeId, refreshFiles])

  const hasCode = sources.length > 0
  const tab = hasCode && chosen?.nodeId === nodeId ? chosen.tab : 'conversation'
  const onCode = tab === 'code'

  return (
    <>
      {hasCode && nodeId ? (
        <div role="tablist" aria-label="Session view" className="flex shrink-0 gap-1 border-b border-gray-200 px-4 pt-2">
          <button
            type="button"
            role="tab"
            id="center-tab-conversation"
            aria-selected={!onCode}
            aria-controls="center-panel-conversation"
            onClick={() => showTab(nodeId, 'conversation')}
            className={`${TAB} ${!onCode ? 'bg-white text-gray-900 shadow-[inset_0_-2px_0_theme(colors.blue.600)]' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Conversation
            {turnRunning ? (
              <span data-testid="conversation-running" className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-blue-700">
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
                <span>{onCode ? 'turn in progress' : ''}</span>
                <span className="sr-only">{onCode ? '' : 'turn in progress'}</span>
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            id="center-tab-code"
            aria-selected={onCode}
            aria-controls="center-panel-code"
            onClick={() => showTab(nodeId, 'code')}
            className={`${TAB} ${onCode ? 'bg-white text-gray-900 shadow-[inset_0_-2px_0_theme(colors.blue.600)]' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Code <span className="text-gray-400">({sources.length})</span>
          </button>
        </div>
      ) : null}
      <div
        id="center-panel-conversation"
        role={hasCode ? 'tabpanel' : undefined}
        aria-labelledby={hasCode ? 'center-tab-conversation' : undefined}
        hidden={onCode}
        className={`${onCode ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col`}
      >
        {conversation}
      </div>
      {onCode && nodeId ? (
        <div id="center-panel-code" role="tabpanel" aria-labelledby="center-tab-code" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CodeTab nodeId={nodeId} sources={sources} />
        </div>
      ) : null}
    </>
  )
}

export default NodeCenterTabs
