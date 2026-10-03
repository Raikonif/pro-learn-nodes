import GraphBreadcrumb from './GraphBreadcrumb'
import GraphMinimap from './GraphMinimap'

/**
 * Picks the right-rail graph form for the space available.
 *
 * The height arrives as a prop instead of being measured. Two reasons: a
 * ResizeObserver reports 0 in jsdom, which would make the collapse rule
 * untestable and permanently stuck on one branch; and the decision belongs to
 * whoever owns the rail's layout, which is the workspace, not the graph.
 */

/**
 * Below this, the minimap plus the practice workbench cannot both be usable —
 * a 160px minimap, its padding, and the block headers leave nothing for a block.
 */
export const MINIMAP_MIN_HEIGHT = 320

/** A comfortable rail on a full-height window; overridden by the workspace. */
export const DEFAULT_AVAILABLE_HEIGHT = 640

export type GraphRailProps = {
  availableHeight?: number
  /**
   * The rail's owner wants the height for something else — an expanded
   * practice block — so the breadcrumb (which still expands on hover) is
   * enough, whatever the height.
   */
  collapsed?: boolean
}

function GraphRail({ availableHeight = DEFAULT_AVAILABLE_HEIGHT, collapsed = false }: GraphRailProps) {
  return !collapsed && availableHeight >= MINIMAP_MIN_HEIGHT ? <GraphMinimap /> : <GraphBreadcrumb />
}

export default GraphRail
