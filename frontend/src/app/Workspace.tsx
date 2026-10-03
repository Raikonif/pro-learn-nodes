import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { GraphCanvas, GraphRail, RecentsRail } from '../features/graph-navigation'
import { NodeConversation, ThreadList, placeInComposer } from '../features/node-chat'
import { PracticeRail, useHasExpandedBlock } from '../features/practice'
import { ProjectDialogHost } from '../features/projects'
import { CommandPalette } from '../features/command-surface'
import { DetailedStartHost, EmptyWorkspaceStart, QuickStartButton } from '../features/study-launcher'
import ResizeHandle from '../shared/components/ResizeHandle'
import {
  CENTER_MIN,
  fitToWindow,
  railMax,
  railMin,
  usePaneLayout,
  type RailSide,
} from '../shared/lib/pane-layout'
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

/** The window's width, kept current so the rails can be fitted to it. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return width
}

const RAIL_NAMES: Record<RailSide, string> = { left: 'node index', right: 'workspace tools' }
const RAIL_IDS: Record<RailSide, string> = { left: 'workspace-left-rail', right: 'workspace-right-rail' }

/** The header control that collapses or expands one rail. */
function RailToggle({ side }: { side: RailSide }) {
  const collapsed = usePaneLayout((s) => s[side].collapsed)
  const toggle = usePaneLayout((s) => s.toggleCollapsed)
  // The glyph points the way the rail will move: a left rail collapses
  // leftward, a right rail rightward.
  const glyph = (side === 'left') === collapsed ? '»' : '«'

  return (
    <button
      type="button"
      onClick={() => toggle(side)}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${RAIL_NAMES[side]}`}
      aria-expanded={!collapsed}
      aria-controls={RAIL_IDS[side]}
      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
    >
      {glyph}
    </button>
  )
}

/** What a collapsed rail leaves behind: a thin strip that expands it again. */
function CollapsedStrip({ side }: { side: RailSide }) {
  const setCollapsed = usePaneLayout((s) => s.setCollapsed)

  return (
    <button
      type="button"
      onClick={() => setCollapsed(side, false)}
      aria-label={`Show ${RAIL_NAMES[side]}`}
      aria-controls={RAIL_IDS[side]}
      className={`flex w-7 shrink-0 items-start justify-center bg-white pt-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 ${
        side === 'left' ? 'border-r' : 'border-l'
      } border-gray-200`}
    >
      {side === 'left' ? '»' : '«'}
    </button>
  )
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
  // An expanded block gets the rail's height; the minimap gives way to its breadcrumb.
  const blockExpanded = useHasExpandedBlock(openNodeId)

  // The store holds what the learner chose; what renders is that choice
  // fitted to the window, so the center never drops below its minimum and a
  // narrower window never overwrites the stored widths.
  const windowWidth = useWindowWidth()
  const left = usePaneLayout((s) => s.left)
  const right = usePaneLayout((s) => s.right)
  const setWidth = usePaneLayout((s) => s.setWidth)
  const resetWidth = usePaneLayout((s) => s.resetWidth)
  const rendered = fitToWindow({ left, right }, windowWidth)
  const [dragging, setDragging] = useState(false)

  // A drag may take a rail only as far as the center's minimum allows.
  function handleMax(side: RailSide): number {
    const other = side === 'left' ? rendered.right : rendered.left
    return Math.max(railMin(side), Math.min(railMax(side, windowWidth), windowWidth - CENTER_MIN - other))
  }

  const leftRailStyle = { '--left-rail': `${rendered.left}px` } as CSSProperties
  const rightRailStyle = { '--right-rail': `${rendered.right}px` } as CSSProperties
  const isReady = status === 'ready'

  return (
    <div className={`flex h-screen flex-col bg-gray-50 text-gray-900 ${dragging ? 'select-none' : ''}`}>
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          {isReady && <RailToggle side="left" />}
          <h1 className="text-sm font-semibold tracking-tight">Learn Nodes</h1>
        </div>
        <div className="flex items-center gap-4">
          <AgentSettingsButton />
          <MemoryButton />
          <AccountAffordance />
          <BackendStatus />
          {isReady && <RailToggle side="right" />}
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
        {/* A collapsed rail stays mounted, only hidden, so whatever it was
            holding — a search in progress, a selected tool — is there when
            it is expanded. Its width is the one inline style allowed. */}
        <aside
          id={RAIL_IDS.left}
          aria-label="Node index"
          data-testid="left-rail"
          hidden={left.collapsed}
          style={leftRailStyle}
          className={`${left.collapsed ? 'hidden' : 'flex'} w-[var(--left-rail)] shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white`}
        >
          <RecentsRail headerAction={<QuickStartButton />} />
        </aside>
        {left.collapsed ? (
          <CollapsedStrip side="left" />
        ) : (
          <ResizeHandle
            side="left"
            label="Resize node index"
            value={rendered.left}
            min={railMin('left')}
            max={handleMax('left')}
            onChange={(width) => setWidth('left', width, windowWidth)}
            onReset={() => resetWidth('left')}
            onDraggingChange={setDragging}
          />
        )}

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

        {right.collapsed ? (
          <CollapsedStrip side="right" />
        ) : (
          <ResizeHandle
            side="right"
            label="Resize workspace tools"
            value={rendered.right}
            min={railMin('right')}
            max={handleMax('right')}
            onChange={(width) => setWidth('right', width, windowWidth)}
            onReset={() => resetWidth('right')}
            onDraggingChange={setDragging}
          />
        )}
        <aside
          ref={rightRailRef}
          id={RAIL_IDS.right}
          aria-label="Workspace tools"
          data-testid="right-rail"
          hidden={right.collapsed}
          style={rightRailStyle}
          className={`${right.collapsed ? 'hidden' : 'flex'} w-[var(--right-rail)] shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white`}
        >
          {isNodeOpen && (
            <>
              {/* Fixed-height minimap pinned on top; tools fill what is left.
                  Not peer tabs — a map you have to select a tab to see gives
                  no orientation, which is the only reason it moved here. */}
              <div data-testid="right-rail-map" className="shrink-0 border-b border-gray-200">
                <GraphRail availableHeight={rightRailHeight} collapsed={blockExpanded} />
              </div>
              <div data-testid="right-rail-tools" className="min-h-0 flex-1 overflow-y-auto">
                <PracticeRail onAskAgent={placeInComposer} />
              </div>
            </>
          )}
        </aside>
          </>
        )}
      </div>

      <AgentSettingsPanel />
      <MemoryPanel />
      {/* The palette's "Start with a topic…" opens the one dialog from here. */}
      <DetailedStartHost />
      {/* The project dialogs (new, rename, instructions, delete) open from the
          rail, the session header and the palette; one host serves them all. */}
      <ProjectDialogHost />
      <CommandPalette />
    </div>
  )
}

export default Workspace
