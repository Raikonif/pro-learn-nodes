import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ResizeHandle from './ResizeHandle'

function renderHandle(overrides: Partial<React.ComponentProps<typeof ResizeHandle>> = {}) {
  const onChange = vi.fn()
  const onReset = vi.fn()
  const onDraggingChange = vi.fn()
  render(
    <ResizeHandle
      side="left"
      label="Resize node index"
      value={240}
      min={180}
      max={420}
      onChange={onChange}
      onReset={onReset}
      onDraggingChange={onDraggingChange}
      {...overrides}
    />,
  )
  return { handle: screen.getByRole('separator', { name: 'Resize node index' }), onChange, onReset, onDraggingChange }
}

describe('ResizeHandle', () => {
  it('is a focusable vertical separator announcing its width and limits', () => {
    const { handle } = renderHandle()

    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '240')
    expect(handle).toHaveAttribute('aria-valuemin', '180')
    expect(handle).toHaveAttribute('aria-valuemax', '420')
    expect(handle).toHaveAttribute('tabindex', '0')
    handle.focus()
    expect(handle).toHaveFocus()
  })

  it('reports the width as the pointer drags a left rail edge, stopping at the limits', () => {
    const { handle, onChange, onDraggingChange } = renderHandle()

    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1, button: 0 })
    expect(onDraggingChange).toHaveBeenLastCalledWith(true)

    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(300)

    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(420)

    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(180)

    fireEvent.pointerUp(handle, { clientX: 0, pointerId: 1 })
    expect(onDraggingChange).toHaveBeenLastCalledWith(false)

    onChange.mockClear()
    fireEvent.pointerMove(handle, { clientX: 350, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('widens a right rail as its edge is dragged toward the center (leftward)', () => {
    const { handle, onChange } = renderHandle({ side: 'right', value: 320, min: 240, max: 600 })

    fireEvent.pointerDown(handle, { clientX: 700, pointerId: 1, button: 0 })
    fireEvent.pointerMove(handle, { clientX: 600, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(420)
  })

  it('moves a left rail edge with the arrow keys, 16px or 64px with Shift', () => {
    const { handle, onChange } = renderHandle()

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(256)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(224)
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(304)
  })

  it('moves a right rail edge toward the center with ArrowLeft', () => {
    const { handle, onChange } = renderHandle({ side: 'right', value: 320, min: 240, max: 600 })

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(336)
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(256)
  })

  it('holds keyboard steps to the limits', () => {
    const { handle, onChange } = renderHandle({ value: 410 })

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(420)
  })

  it('resets on double-click', () => {
    const { handle, onReset } = renderHandle()

    fireEvent.doubleClick(handle)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
