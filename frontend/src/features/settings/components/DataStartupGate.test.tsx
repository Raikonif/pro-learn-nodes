import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DataStartupGate from './DataStartupGate'

const invoke = vi.hoisted(() => vi.fn())
const open = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open }))

function info(startup: unknown) {
  return {
    available: true,
    unavailableReason: null,
    path: '/Volumes/Drive/learn',
    isDefault: false,
    contents: null,
    startup,
    leftovers: [],
    previous: null,
    moving: false,
  }
}

const FAILED = {
  outcome: 'failed',
  path: '/Volumes/Drive/learn',
  problem: { status: 'missing', detail: '/Volumes/Drive/learn does not exist' },
  notices: [],
}

/** Click, then let the handler's promises (dynamic imports included) settle. */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element)
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => vi.stubEnv('VITE_API_MODE', 'unix'))

afterEach(() => {
  vi.unstubAllEnvs()
  invoke.mockReset()
  open.mockReset()
})

describe('DataStartupGate', () => {
  it('lets the app through when the data started fine', async () => {
    invoke.mockResolvedValue(info({ outcome: 'ready', path: '/x', notices: [] }))
    render(<DataStartupGate>app</DataStartupGate>)

    expect(screen.getByText('app')).toBeInTheDocument()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('data_location_info', undefined))
    expect(screen.queryByTestId('data-startup-notices')).toBeNull()
  })

  it('says what was restored, and the notice can be dismissed', async () => {
    const notice = 'The data could not be read. Learn Nodes restored the copy of your data taken on 2026-09-01 10:10 UTC.'
    invoke.mockImplementation(async (command: string) =>
      command === 'data_location_info' ? info({ outcome: 'ready', path: '/x', notices: [notice] }) : undefined,
    )
    render(<DataStartupGate>app</DataStartupGate>)

    expect(await screen.findByTestId('data-startup-notices')).toHaveTextContent('2026-09-01 10:10 UTC')
    expect(screen.getByText('app')).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('data-startup-notices')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('data_location_dismiss', undefined)
  })

  it('a start with nothing to restore shows the problem instead of the app, and replaces nothing', async () => {
    invoke.mockResolvedValue(info(FAILED))
    render(<DataStartupGate>app</DataStartupGate>)

    const screenEl = await screen.findByTestId('data-recovery-screen')
    expect(screenEl).toHaveTextContent('The data folder is missing. /Volumes/Drive/learn does not exist')
    expect(screenEl).toHaveTextContent('Nothing has been replaced')
    expect(screen.queryByText('app')).toBeNull()
    for (const name of ['Retry', 'Choose another folder…', 'Start on the default folder']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
  })

  it('retrying a start that now succeeds reloads the window', async () => {
    const reload = vi.fn()
    invoke.mockImplementation(async (command: string) =>
      command === 'data_location_info' ? info(FAILED) : { outcome: 'ready', path: '/Volumes/Drive/learn', notices: [] },
    )
    render(<DataStartupGate reload={reload}>app</DataStartupGate>)
    await click(await screen.findByRole('button', { name: 'Retry' }))

    expect(invoke).toHaveBeenCalledWith('data_startup_recover', { action: 'retry', folder: null })
    expect(reload).toHaveBeenCalled()
  })

  it('choosing another folder passes it on, and a second failure stays on the screen with the new problem', async () => {
    open.mockResolvedValue('/Volumes/Other/learn')
    const reload = vi.fn()
    invoke.mockImplementation(async (command: string) =>
      command === 'data_location_info'
        ? info(FAILED)
        : { ...FAILED, path: '/Volumes/Other/learn', problem: { status: 'damaged', detail: 'quick_check failed' } },
    )
    render(<DataStartupGate reload={reload}>app</DataStartupGate>)
    await click(await screen.findByRole('button', { name: 'Choose another folder…' }))

    expect(invoke).toHaveBeenCalledWith('data_startup_recover', { action: 'folder', folder: '/Volumes/Other/learn' })
    expect(await screen.findByText('The data could not be read. quick_check failed')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })

  it('starting on the default folder is the learner’s choice, never made for them', async () => {
    const reload = vi.fn()
    invoke.mockImplementation(async (command: string) =>
      command === 'data_location_info' ? info(FAILED) : { outcome: 'ready', path: '/default', notices: [] },
    )
    render(<DataStartupGate reload={reload}>app</DataStartupGate>)
    await screen.findByTestId('data-recovery-screen')
    expect(invoke).not.toHaveBeenCalledWith('data_startup_recover', expect.anything())

    await click(screen.getByRole('button', { name: 'Start on the default folder' }))
    expect(invoke).toHaveBeenCalledWith('data_startup_recover', { action: 'default', folder: null })
    expect(reload).toHaveBeenCalled()
  })

  it('in the browser build the shell is never asked', async () => {
    vi.stubEnv('VITE_API_MODE', 'http')
    render(<DataStartupGate>app</DataStartupGate>)

    expect(screen.getByText('app')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invoke).not.toHaveBeenCalled()
  })
})
