import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

const STEP = 16
const LARGE_STEP = 64

interface ResizeHandleProps {
  /** Which rail this edge belongs to; decides which direction widens it. */
  side: 'left' | 'right'
  label: string
  /** The rail's rendered width. */
  value: number
  min: number
  max: number
  onChange: (width: number) => void
  /** Double-activation: back to the rail's default width. */
  onReset: () => void
  /** Lets the owner suppress text selection while a drag is in progress. */
  onDraggingChange?: (dragging: boolean) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The draggable inner edge of a workspace rail: an ARIA separator that is
 * moved by pointer (with pointer capture, so a fast drag that leaves the thin
 * handle keeps tracking) or by the arrow keys, and reset by double-click.
 *
 * It only reports widths; the owner decides what to store. A left rail's edge
 * widens moving right, a right rail's edge widens moving left — toward the
 * center either way.
 */
function ResizeHandle({ side, label, value, min, max, onChange, onReset, onDraggingChange }: ResizeHandleProps) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const direction = side === 'left' ? 1 : -1

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    // Without this the drag starts a text selection across the conversation.
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: value }
    onDraggingChange?.(true)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    onChange(clamp(active.startWidth + direction * (event.clientX - active.startX), min, max))
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onDraggingChange?.(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? LARGE_STEP : STEP
    const sign = event.key === 'ArrowRight' ? 1 : -1
    onChange(clamp(value + direction * sign * step, min, max))
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
      // Zero net layout width (w-1 with -mx-0.5): the edge overlays the
      // border it sits on instead of taking room from the panes.
      className="relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize touch-none bg-transparent outline-none hover:bg-blue-300 focus-visible:bg-blue-500 active:bg-blue-400"
    />
  )
}

export default ResizeHandle
