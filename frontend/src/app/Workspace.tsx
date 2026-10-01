import { useEffect, useRef, useState } from 'react'

import { GraphCanvas, GraphRail, RecentsRail } from '../features/graph-navigation'
import { NodeConversation, ThreadList } from '../features/node-chat'
import { PracticeRail } from '../features/practice'
import { EmptyWorkspaceStart, QuickStartButton } from '../features/study-launcher'
import { useWorkspaceStore } from '../shared/lib/workspace-store'

import { AccountAffordance } from '../features/account'
import { MemoryButton, MemoryPanel } from '../features/memory'
import { AgentSettingsButton, AgentSettingsPanel } from '../features/settings'

import BackendStatus from './BackendStatus'

/**
 * The three-pane workspace: node index on the left, graph-or-conversation in
 * the center, minimap-over-tools on the right.
 *
 * The center/right relationship is the load-bearing part. With no node open
 * the graph owns the center and the right rail is idle. Opening a node moves
 * the conversation into the center and demotes the graph to a right-rail
 * minimap — demoted, never dismissed. That is what "graph navigation IS the
 * product" means in practice: the map stays on screen while you are in a
 * place, so you never lose your position by entering a node.
 *
 * The left rail is deliberately an INDEX (the session history + search, with
 * the quick start in its header), not the primary navigation. Navigation happens in the graph. Letting the rail become the
 * main way around would turn this into the chat list the mission rules out.
 */
/**
 * Measures an element's height so `GraphRail` can decide between the minimap
 * and the collapsed breadcrumb.
 *
 * `GraphRail` takes the height as a prop rather than measuring itself — that
 * is what makes the collapse assertable under jsdom, which performs no
 * layout. The measurement has to happen somewhere real, though, or the
 * breadcrumb would never appear in the actual app. Here is that somewhere.
 *
 * Returns `undefined` where `ResizeObserver` is unavailable (jsdom), which
 * leaves `GraphRail` on its default and keeps the unit suite deterministic.
 */
function useMeasuredHeight(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return height
}

function Workspace() {
  const status = useWorkspaceStore((s) => s.status)
  const startupError = useWorkspaceStore((s) => s.startupError)
  const hydrate = useWorkspaceStore((s) => s.hydrate)
  const openNodeId = useWorkspaceStore((s) => s.openNodeId)
  const isNodeOpen = openNodeId !== null
  // An account with no sessions gets both ways to begin instead of a graph
  // with nothing on it.
  const hasNoSessions = useWorkspaceStore((s) => s.graph.nodes.length === 0)
  const rightRailRef = useRef<HTMLElement | null>(null)
  const rightRailHeight = useMeasuredHeight(rightRailRef)

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-900">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">Learn Nodes</h1>
        <div className="flex items-center gap-4">
          <AgentSettingsButton />
          <MemoryButton />
          <AccountAffordance />
          <BackendStatus />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {status !== 'ready' ? (
          <main
            aria-label="Workspace startup"
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3"
          >
            {status === 'loading' ? (
              <p className="text-sm text-gray-600">Loading your workspace…</p>
            ) : (
              <>
                <p className="max-w-md text-center text-sm text-red-700">
                  Unable to load your local workspace: {startupError}
                </p>
                <button
                  type="button"
                  onClick={() => void hydrate()}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Retry
                </button>
              </>
            )}
          </main>
        ) : (
          <>
        <aside
          aria-label="Node index"
          data-testid="left-rail"
          className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white lg:w-56"
        >
          <RecentsRail headerAction={<QuickStartButton />} />
        </aside>

        <main
          aria-label={isNodeOpen ? 'Node conversation' : hasNoSessions ? 'Start a session' : 'Session graph'}
          data-testid="center-region"
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          {isNodeOpen ? (
            <>
              <ThreadList />
              <NodeConversation />
            </>
          ) : hasNoSessions ? (
            <EmptyWorkspaceStart />
          ) : (
            <GraphCanvas />
          )}
        </main>

        <aside
          ref={rightRailRef}
          aria-label="Workspace tools"
          data-testid="right-rail"
          className="flex w-48 shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white lg:w-72"
        >
          {isNodeOpen && (
            <>
              {/* Fixed-height minimap pinned on top; tools fill what is left.
                  Not peer tabs — a map you have to select a tab to see gives
                  no orientation, which is the only reason it moved here. */}
              <div data-testid="right-rail-map" className="shrink-0 border-b border-gray-200">
                <GraphRail availableHeight={rightRailHeight} />
              </div>
              <div data-testid="right-rail-tools" className="min-h-0 flex-1 overflow-y-auto">
                <PracticeRail />
              </div>
            </>
          )}
        </aside>
          </>
        )}
      </div>

      <AgentSettingsPanel />
      <MemoryPanel />
    </div>
  )
}

export default Workspace
