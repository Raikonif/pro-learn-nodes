import GraphCanvas from './GraphCanvas'

/**
 * The graph in its right-rail form: a fixed-height region at the top of the
 * rail, stacked above the practice tools rather than tabbed beside them, so
 * choosing a practice tool never costs you sight of the graph.
 *
 * The height is fixed here (not `flex-1`) because the practice tools below
 * must get the remaining space; a minimap that grows with the window would
 * squeeze them out at 800×600.
 */
function GraphMinimap() {
  return (
    <section
      aria-label="Graph minimap"
      data-testid="graph-minimap"
      className="h-40 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white p-2"
    >
      {/* Node activation goes straight to `openNode` — no close-then-open.
          Closing first would flash the center graph between two nodes and
          discard the open thread for a frame. */}
      <GraphCanvas variant="minimap" />
    </section>
  )
}

export default GraphMinimap
