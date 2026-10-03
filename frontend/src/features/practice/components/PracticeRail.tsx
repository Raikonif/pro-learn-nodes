import { useEffect, useId, useRef, useState } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { usePracticeStore } from '../practice-store'
import type { Block } from '../workbench/blocks'
import { ADDABLE_KINDS, BLOCK_KINDS } from '../workbench/kinds'
import { summarize, titleOf } from '../workbench/summaries'
import { useWorkbench } from '../workbench/use-workbench'

import { ToolLoading, ToolUnavailable } from './ToolStates'

/**
 * The workbench: the open node's practice as blocks, below the minimap.
 *
 * A block is one unit of work — a delivery's questions, one exercise, what the
 * learner wrote, the scratch buffer. One is expanded and takes the height; the
 * rest are one-line headers saying what is left to do. Blocks appear when the
 * work exists or is asked for, instead of tabs that are there whether or not
 * they hold anything (practice-workbench design.md).
 *
 * Renders nothing with no node open: practice belongs to a node and there is
 * no practice anywhere else.
 */
function PracticeRail({ onAskAgent }: { onAskAgent?: (command: string) => void }) {
  const nodeId = useWorkspaceStore((s) => s.openNodeId)
  const load = usePracticeStore((s) => s.load)
  const flushNode = usePracticeStore((s) => s.flushNode)
  const highlight = usePracticeStore((s) => s.highlight)
  const material = usePracticeStore((s) => (nodeId === null ? undefined : s.material[nodeId]))
  const { blocks, closed, expanded } = useWorkbench(nodeId)
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
  }, [highlight, nodeId, material, expanded])

  if (nodeId === null) return null

  let content: React.ReactNode
  if (!material || material.status === 'loading') {
    content = <ToolLoading>Loading this node's practice…</ToolLoading>
  } else if (material.status === 'failed') {
    content = (
      <ToolUnavailable
        what="This node's practice material could not be loaded."
        reason={material.reason}
        onRetry={() => void load(nodeId)}
      />
    )
  } else if (blocks.length === 0 && closed.length > 0) {
    content = (
      <p data-testid="workbench-all-closed" className="p-2 text-xs text-gray-600">
        Every block on this node is closed. Reopen one below, or add more.
      </p>
    )
  } else if (blocks.length === 0) {
    content = (
      <div data-testid="workbench-empty" className="flex flex-col gap-1 p-2 text-xs text-gray-600">
        <p>This node has no practice yet.</p>
        <p>
          Add some with <span className="font-medium">+ Add</span>, or ask the agent with <code>/code</code>,{' '}
          <code>/qa</code> or <code>/quiz</code>.
        </p>
      </div>
    )
  } else {
    content = (
      <ul aria-label="Practice blocks" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {blocks.map((block) => (
          <BlockEntry key={block.key} nodeId={nodeId} block={block} expanded={block.key === expanded} />
        ))}
      </ul>
    )
  }

  return (
    <section
      ref={panelRef}
      aria-label="Practice"
      data-testid="practice-rail"
      className="flex min-h-0 flex-1 flex-col bg-white"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-2 py-1">
        <h2 className="text-xs font-semibold text-gray-700">Practice</h2>
        {/* Hidden until the material is read: an entry chosen meanwhile
            would change nothing visible. */}
        {material?.status === 'ready' && <AddMenu nodeId={nodeId} onAskAgent={onAskAgent} />}
      </div>
      {content}
      {closed.length > 0 && <ClosedBlocks nodeId={nodeId} blocks={closed} />}
    </section>
  )
}

function useBlockText(nodeId: string, block: Block): { title: string; summary: string } {
  const material = usePracticeStore((s) => s.material[nodeId])
  const scratch = usePracticeStore((s) => s.buffers[nodeId] ?? '')
  if (material?.status !== 'ready') return { title: '', summary: '' }
  return {
    title: titleOf(block, material.items),
    summary: summarize(block, material.items, material.attempts, scratch),
  }
}

function BlockEntry({ nodeId, block, expanded }: { nodeId: string; block: Block; expanded: boolean }) {
  const expandBlock = usePracticeStore((s) => s.expandBlock)
  const closeBlock = usePracticeStore((s) => s.closeBlock)
  const authoring = usePracticeStore((s) => s.authoring)
  const consumeAuthoring = usePracticeStore((s) => s.consumeAuthoring)
  const highlighted = usePracticeStore(
    (s) => s.highlight?.nodeId === nodeId && block.itemIds.some((id) => s.highlight?.itemIds.includes(id)),
  )
  const { title, summary } = useBlockText(nodeId, block)
  const bodyId = useId()
  const kind = BLOCK_KINDS[block.kind]
  const startAuthoring = expanded && authoring?.nodeId === nodeId && authoring.block === block.key

  // The body has read the request by the time this runs (children's effects
  // run first); consuming it keeps a later re-expansion from reopening the form.
  useEffect(() => {
    if (startAuthoring) consumeAuthoring()
  }, [startAuthoring, consumeAuthoring])

  return (
    <li
      data-testid="practice-block"
      data-block-key={block.key}
      className={`flex flex-col border-b border-gray-200 ${expanded ? 'min-h-[16rem] flex-1' : 'shrink-0'}`}
    >
      <div
        data-highlighted={highlighted ? 'true' : undefined}
        className={`flex items-center gap-1 px-2 py-1 transition-colors duration-700 ${
          highlighted ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : expanded ? 'bg-gray-50' : ''
        }`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          // The visible text is badge, title and status run together; read
          // aloud, it needs the separators the layout gives the eye.
          aria-label={`${kind.label}: ${title}, ${block.author ? `by ${block.author.name}, ` : ''}${summary}`}
          onClick={() => expandBlock(nodeId, expanded ? null : block.key)}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left text-xs"
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-gray-400">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
            {kind.label}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{title}</span>
          <span className="shrink-0 text-[10px] text-gray-500">
            {block.author ? `${block.author.name} · ` : ''}
            {summary}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Close ${kind.label}: ${title}`}
          onClick={() => closeBlock(nodeId, block.key)}
          className="shrink-0 rounded px-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ×
        </button>
      </div>
      {expanded && (
        <div id={bodyId} role="region" aria-label={title} className="min-h-0 flex-1 overflow-y-auto p-2">
          <kind.Body nodeId={nodeId} block={block} startAuthoring={startAuthoring} />
        </div>
      )}
    </li>
  )
}

/** Closed blocks: out of the list, never deleted, one action away from returning. */
function ClosedBlocks({ nodeId, blocks }: { nodeId: string; blocks: Block[] }) {
  const [open, setOpen] = useState(false)
  const openBlock = usePracticeStore((s) => s.openBlock)
  const listId = useId()
  return (
    <div className="shrink-0 border-t border-gray-200 px-2 py-1 text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        className="text-gray-500 hover:text-gray-800"
      >
        Closed ({blocks.length})
      </button>
      {open && (
        <ul id={listId} aria-label="Closed blocks" className="mt-1 flex flex-col gap-1">
          {blocks.map((block) => (
            <ClosedEntry key={block.key} nodeId={nodeId} block={block} onReopen={() => openBlock(nodeId, block.key)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ClosedEntry({ nodeId, block, onReopen }: { nodeId: string; block: Block; onReopen: () => void }) {
  const { title } = useBlockText(nodeId, block)
  const label = `${BLOCK_KINDS[block.kind].label}: ${title}`
  return (
    <li className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-gray-700">{label}</span>
      <button type="button" onClick={onReopen} aria-label={`Reopen ${label}`} className="text-blue-700 underline">
        Reopen
      </button>
    </li>
  )
}

/**
 * The add control: for each kind, writing it oneself or asking the agent —
 * which places the command in the composer and sends nothing.
 */
function AddMenu({ nodeId, onAskAgent }: { nodeId: string; onAskAgent?: (command: string) => void }) {
  const [open, setOpen] = useState(false)
  const openBlock = usePracticeStore((s) => s.openBlock)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  function choose(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
        className="rounded px-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
      >
        + Add
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label="Add practice"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
          className="absolute right-0 z-20 mt-1 w-56 rounded border border-gray-200 bg-white py-1 text-xs shadow-lg"
        >
          {ADDABLE_KINDS.flatMap((id) => {
            const add = BLOCK_KINDS[id].add
            if (!add) return []
            const entries = [
              <li key={`${id}-write`} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => choose(() => openBlock(nodeId, add.write.block, { author: add.write.author }))}
                  className="w-full px-2 py-1 text-left text-gray-800 hover:bg-gray-100"
                >
                  {add.write.label}
                </button>
              </li>,
            ]
            if (onAskAgent) {
              entries.push(
                <li key={`${id}-ask`} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => choose(() => onAskAgent(add.ask.command))}
                    className="w-full px-2 py-1 text-left text-gray-800 hover:bg-gray-100"
                  >
                    {add.ask.label} <code className="text-gray-500">{add.ask.command.trim()}</code>
                  </button>
                </li>,
              )
            }
            return entries
          })}
        </ul>
      )}
    </div>
  )
}

export default PracticeRail
