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
 * Below this, the minimap plus the practice tools cannot both be usable —
 * a 160px minimap, its padding, and the tab strip leave nothing for a panel.
 */
export const MINIMAP_MIN_HEIGHT = 320

/** A comfortable rail on a full-height window; overridden by the workspace. */
export const DEFAULT_AVAILABLE_HEIGHT = 640

export type GraphRailProps = {
  availableHeight?: number
}

function GraphRail({ availableHeight = DEFAULT_AVAILABLE_HEIGHT }: GraphRailProps) {
  return availableHeight >= MINIMAP_MIN_HEIGHT ? <GraphMinimap /> : <GraphBreadcrumb />
}

export default GraphRail
