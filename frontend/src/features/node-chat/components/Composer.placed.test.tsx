import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import { placeInComposer } from '../index'
import { useTurnStore } from '../turn-store'

import Composer from './Composer'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Composer — text placed from elsewhere (practice-workbench 3.5)', () => {
  it('replaces the draft, focuses it, and sends nothing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const send = vi.spyOn(useTurnStore.getState(), 'send')
    render(<Composer threadId="t-1" />)
    const box = screen.getByRole('textbox')

    await act(async () => {
      placeInComposer('/code ')
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    expect(box).toHaveValue('/code ')
    expect(box).toHaveFocus()
    expect((box as HTMLTextAreaElement).selectionStart).toBe('/code '.length)
    expect(send).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
