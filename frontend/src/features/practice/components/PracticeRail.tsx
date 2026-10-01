import { useEffect, useRef } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { usePracticeStore, type PracticeTool } from '../practice-store'

import QuestionsTool from './QuestionsTool'
import QuizTool from './QuizTool'
import CodeTool from './CodeTool'

/**
 * Practice tools in the right rail, below the minimap.
 *
 * The three tools are tabs of each other, but they are NOT peers of the
 * minimap — the minimap sits above this whole strip and stays put whichever
 * tool is selected. Tabs rather than stacked sections because at 800×600 the
 * sandbox needs the region's full height (design.md "The tools are tabs").
 *
 * Renders nothing with no node open: practice belongs to a node and there is
 * no practice anywhere else.
 */

const TABS: { id: PracticeTool; label: string }[] = [
  { id: 'questions', label: 'Q&A' },
  { id: 'sandbox', label: 'Code' },
  { id: 'quiz', label: 'Quiz' },
]

function PracticeRail() {
  const nodeId = useWorkspaceStore((s) => s.openNodeId)
  // The practice store, not the workspace store or node data: which tool you
  // are looking at is a view preference of this window. It survives opening
  // another node and is never sent anywhere.
  const selected = usePracticeStore((s) => s.selectedTool)
  const selectTool = usePracticeStore((s) => s.selectTool)
  const load = usePracticeStore((s) => s.load)
  const flushNode = usePracticeStore((s) => s.flushNode)
  const highlight = usePracticeStore((s) => s.highlight)
  // Subscribed so the scroll below runs again when a re-read lands.
  const material = usePracticeStore((s) => (nodeId === null ? undefined : s.material[nodeId]))
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scrolledFor = useRef(0)

  useEffect(() => {
    if (nodeId === null) return
    void load(nodeId)
    // Leaving the node — opening another, or closing it — writes any edit
    // still waiting on the debounce, so the ordinary exits lose nothing.
    return () => void flushNode(nodeId)
  }, [nodeId, load, flushNode])

  // Delivered items are brought into view once, as soon as they are rendered
  // (the re-read that brings them may finish after the reveal itself).
  useEffect(() => {
    if (!highlight || highlight.nodeId !== nodeId || scrolledFor.current === highlight.seq) return
    const target = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[data-practice-item-id]') ?? [],
    ).find((element) => highlight.itemIds.includes(element.dataset.practiceItemId ?? ''))
    if (!target) return
    scrolledFor.current = highlight.seq
    target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [highlight, nodeId, material, selected])

  if (nodeId === null) return null

  return (
    <section
      aria-label="Practice tools"
      data-testid="practice-rail"
      className="flex min-h-0 flex-1 flex-col rounded-md border border-gray-200 bg-white"
    >
      <div role="tablist" aria-label="Practice tools" className="flex shrink-0 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`practice-tab-${tab.id}`}
            aria-selected={tab.id === selected}
            aria-controls={`practice-panel-${tab.id}`}
            onClick={() => selectTool(tab.id)}
            className={`flex-1 px-2 py-1 text-xs ${
              tab.id === selected
                ? 'border-b-2 border-blue-600 font-semibold text-blue-700'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        ref={panelRef}
        role="tabpanel"
        id={`practice-panel-${selected}`}
        aria-labelledby={`practice-tab-${selected}`}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        {selected === 'questions' && <QuestionsTool nodeId={nodeId} />}
        {selected === 'sandbox' && <CodeTool nodeId={nodeId} />}
        {selected === 'quiz' && <QuizTool nodeId={nodeId} />}
      </div>
    </section>
  )
}

export default PracticeRail
