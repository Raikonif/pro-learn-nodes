import { createAnchor } from '../../../shared/lib/anchor-resolver'
import { messageById } from '../../../shared/lib/fixtures'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { useTextSelection, type MessageSelection } from '../hooks/use-text-selection'

type SelectionAffordanceProps = {
  /**
   * Test / host seam. `undefined` (the default) means "read the live document
   * selection"; passing a value — including `null` — puts the component under
   * the caller's control. Real browser selection is unreproducible in jsdom,
   * and a component that can only be driven by it cannot be tested honestly.
   */
  selection?: MessageSelection | null
}

/**
 * The two-action branch affordance raised by a selection inside a message.
 *
 * Exactly two actions, always: "Generate node" promotes the passage to a
 * session in the graph, "New chat" keeps it inside the current node as a side
 * thread. There is no third path — the pair is the whole decision the learner
 * is being asked to make.
 */
function SelectionAffordance({ selection: injected }: SelectionAffordanceProps) {
  const domSelection = useTextSelection()
  const graph = useWorkspaceStore((s) => s.graph)
  const openNodeId = useWorkspaceStore((s) => s.openNodeId)
  const generateNodeFrom = useWorkspaceStore((s) => s.generateNodeFrom)
  const createThreadFrom = useWorkspaceStore((s) => s.createThreadFrom)

  const active = injected === undefined ? domSelection : injected
  if (!active) return null

  const message = messageById(graph, active.messageId)
  // A selection that is not inside a known message raises nothing at all.
  if (!message) return null
  if (active.end <= active.start) return null

  /**
   * The owning node comes from the message's thread, not from `openNodeId`
   * alone: a selection made three threads deep still belongs to the node that
   * owns those threads, and a branch must never be attached to a thread.
   */
  const owningNodeId =
    graph.threads.find((t) => t.id === message.threadId)?.nodeId ?? openNodeId
  if (!owningNodeId) return null

  // Built once per action so the excerpt is sliced and STORED at creation
  // time — never re-derived later, when the source text may have moved.
  const buildAnchor = () => createAnchor(message, active.start, active.end)

  const dismiss = () => {
    // Dropping the range fires `selectionchange`, which is what actually
    // retracts the affordance in the uncontrolled case.
    if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges()
  }

  return (
    <div
      role="toolbar"
      aria-label="Branch from selection"
      className="fixed bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
    >
      <button
        type="button"
        onClick={() => {
          void Promise.resolve(generateNodeFrom(owningNodeId, buildAnchor())).then(dismiss)
        }}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
      >
        Generate node
      </button>
      <span aria-hidden="true" className="h-4 w-px bg-gray-200" />
      <button
        type="button"
        onClick={() => {
          void Promise.resolve(createThreadFrom(owningNodeId, buildAnchor())).then(dismiss)
        }}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
      >
        New chat
      </button>
    </div>
  )
}

export default SelectionAffordance
