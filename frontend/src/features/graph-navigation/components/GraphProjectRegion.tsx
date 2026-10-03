import { memo } from 'react'

import type { NodeProps } from '@xyflow/react'

import type { GraphRegionNode } from './graph-adapter'

/**
 * The backdrop of one project on the canvas: a labelled rounded rectangle
 * behind its cards.
 *
 * Decoration only. It takes no focus and no pointer events, so it is never a
 * target for navigation, and the fill is light enough that a link crossing it
 * stays legible — the grouping must not read as containment, because a link
 * is allowed to leave it.
 */
function GraphProjectRegion({ data }: NodeProps<GraphRegionNode>) {
  return (
    <div
      data-testid="project-region"
      data-project-id={data.projectId}
      className="pointer-events-none h-full w-full rounded-2xl border border-dashed border-blue-200 bg-blue-50/40"
    >
      <p
        data-testid="project-region-label"
        className="truncate px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-blue-700/70"
      >
        {data.name}
      </p>
    </div>
  )
}

export default memo(GraphProjectRegion)
