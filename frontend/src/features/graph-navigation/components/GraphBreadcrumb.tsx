import { Fragment, useMemo, useState } from 'react'

import { nodeById, parentsOf } from '../../../shared/lib/fixtures'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { WorkspaceGraph, WorkspaceNode } from '../../../shared/lib/workspace-types'
import GraphMinimap from './GraphMinimap'

/**
 * The minimap's collapsed form: a one-line strip naming the path down to the
 * open node, for when the right rail is too short to hold the minimap and the
 * practice tools at once.
 *
 * It collapses rather than disappears because losing the minimap would also
 * lose the only permanent answer to "where am I in the graph" — the strip
 * keeps that answer, and hovering brings the full picture back.
 */

/**
 * Ancestors of `nodeId`, root first, then the node itself.
 *
 * A node can have several parents (Functors has two), but a breadcrumb is a
 * single line — so this follows the first parent and accepts that it names
 * *a* path rather than every path. The full set of parents stays visible in
 * the minimap one hover away.
 */
export function pathToNode(graph: WorkspaceGraph, nodeId: string | null): WorkspaceNode[] {
  if (!nodeId) return []
  const path: WorkspaceNode[] = []
  const seen = new Set<string>()
  let current: string | undefined = nodeId
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = nodeById(graph, current)
    if (!node) break
    path.unshift(node)
    current = parentsOf(graph, current)[0]
  }
  return path
}

function GraphBreadcrumb() {
  const graph = useWorkspaceStore((state) => state.graph)
  const openNodeId = useWorkspaceStore((state) => state.openNodeId)
  const [expanded, setExpanded] = useState(false)

  const path = useMemo(() => pathToNode(graph, openNodeId), [graph, openNodeId])

  return (
    // Hover state lives on the wrapper, not on the strip: the strip is
    // replaced by the minimap when expanded, and a mouseleave can only fire
    // from an element that stays mounted across that swap.
    <div
      data-testid="graph-breadcrumb-region"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
      className="shrink-0"
    >
      {expanded ? (
        <GraphMinimap />
      ) : (
        <nav
          aria-label="Graph breadcrumb"
          data-testid="graph-breadcrumb"
          tabIndex={0}
          className="flex items-center gap-1 overflow-hidden truncate rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 focus:outline-none"
        >
          {path.length === 0 ? (
            <span className="text-gray-400">No node open</span>
          ) : (
            path.map((node, index) => (
              <Fragment key={node.id}>
                {index > 0 && (
                  <span aria-hidden="true" className="text-gray-300">
                    ›
                  </span>
                )}
                <span
                  className={
                    index === path.length - 1 ? 'font-semibold text-gray-900' : 'truncate'
                  }
                >
                  {node.title}
                </span>
              </Fragment>
            ))
          )}
        </nav>
      )}
    </div>
  )
}

export default GraphBreadcrumb
