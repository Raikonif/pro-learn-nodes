import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DataLocationSection from './DataLocationSection'

// The shell's commands do not exist under jsdom: each is answered here.
const invoke = vi.hoisted(() => vi.fn())
const listen = vi.hoisted(() => vi.fn())
const open = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open }))

const INFO = {
  available: true,
  unavailableReason: null,
  path: '/Users/ada/Library/Application Support/com.learnnodes.app',
  isDefault: true,
  contents: { databaseBytes: 2048, backups: 2, backupBytes: 4096, nodeFolders: 3, totalBytes: 10240 },
  startup: { outcome: 'ready', path: '/x', notices: [] },
  leftovers: [],
  previous: null,
  moving: false,
}

type Handler = (args?: Record<string, unknown>) => unknown

function answer(handlers: Record<string, Handler>) {
  invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command]
    if (!handler) throw new Error(`unexpected command ${command}`)
    return handler(args)
  })
}

/** Click, then let the handler's promises (dynamic imports included) settle. */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element)
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  vi.stubEnv('VITE_API_MODE', 'unix')
  listen.mockResolvedValue(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  invoke.mockReset()
  listen.mockReset()
  open.mockReset()
})

describe('DataLocationSection', () => {
  it('shows where the data is, what it holds, and that the keychain is not moved', async () => {
    answer({ data_location_info: () => INFO })
    render(<DataLocationSection />)

    expect(await screen.findByTestId('data-location-path')).toHaveTextContent(INFO.path)
    expect(screen.getByTestId('data-location-path')).toHaveTextContent('(default)')
    const section = screen.getByRole('region', { name: 'Data location' })
    expect(section).toHaveTextContent('10.0 KB in all')
    expect(section).toHaveTextContent('2 backups')
    expect(section).toHaveTextContent('3 session folders')
    expect(section).toHaveTextContent('keychain and are not moved')
  })

  it('says the setting is unavailable in a development build, and where to change it, without asking a shell', async () => {
    vi.stubEnv('VITE_API_MODE', 'http')
    render(<DataLocationSection />)

    expect(await screen.findByTestId('data-location-unavailable')).toHaveTextContent('pnpm tauri build')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('refuses a folder that is not empty, with the reason, and moves nothing', async () => {
    open.mockResolvedValue('/Volumes/Data/full')
    answer({
      data_location_info: () => INFO,
      data_location_check: () => ({ ok: false, reason: 'The folder must be empty.', warnings: [], neededBytes: 10240 }),
    })
    render(<DataLocationSection />)
    await click(await screen.findByRole('button', { name: 'Change…' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('/Volumes/Data/full cannot be used: The folder must be empty.')
    expect(invoke).not.toHaveBeenCalledWith('data_location_move', expect.anything())
  })

  it('a cancelled folder picker changes nothing', async () => {
    open.mockResolvedValue(null)
    answer({ data_location_info: () => INFO })
    render(<DataLocationSection />)
    await click(await screen.findByRole('button', { name: 'Change…' }))

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Change…' })).toBeEnabled()
  })

  it('warns about a synced folder, moves on confirmation with progress, and reports the new place', async () => {
    open.mockResolvedValue('/Users/ada/Dropbox/learn')
    let progress: ((event: { payload: { copiedBytes: number; totalBytes: number } }) => void) | null = null
    listen.mockImplementation(async (_event: string, handler: typeof progress) => {
      progress = handler
      return () => {}
    })
    let finish: (value: unknown) => void = () => {}
    answer({
      data_location_info: () => INFO,
      data_location_check: () => ({ ok: true, reason: null, warnings: ['This folder looks synced by a cloud service.'], neededBytes: 10240 }),
      data_location_move: () => new Promise((resolve) => (finish = resolve)),
    })
    render(<DataLocationSection />)
    await click(await screen.findByRole('button', { name: 'Change…' }))

    const confirm = await screen.findByTestId('data-location-confirm')
    expect(within(confirm).getByRole('note')).toHaveTextContent('synced by a cloud service')
    await click(within(confirm).getByRole('button', { name: 'Move anyway' }))

    await waitFor(() => expect(progress).not.toBeNull())
    act(() => progress!({ payload: { copiedBytes: 5120, totalBytes: 10240 } }))
    expect(screen.getByRole('progressbar', { name: 'Data copied' })).toHaveAttribute('value', '5120')
    expect(screen.getByText('5.0 KB of 10.0 KB')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('data_location_move', { target: '/Users/ada/Dropbox/learn' })

    await act(async () => finish({ outcome: 'completed', path: '/Users/ada/Dropbox/learn', leftovers: [] }))
    expect(await screen.findByText('The data now lives in /Users/ada/Dropbox/learn.')).toBeInTheDocument()
  })

  it('an abandoned move says the data stayed and why', async () => {
    open.mockResolvedValue('/Volumes/Data/learn')
    answer({
      data_location_info: () => INFO,
      data_location_check: () => ({ ok: true, reason: null, warnings: [], neededBytes: 10 }),
      data_location_move: () => ({ outcome: 'abandoned', reason: 'The data stayed where it was. notes.md differs from the original' }),
    })
    render(<DataLocationSection />)
    await click(await screen.findByRole('button', { name: 'Change…' }))
    await click(await screen.findByRole('button', { name: 'Move data' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The move did not happen. The data stayed where it was. notes.md differs')
  })

  it('lists what the previous folder kept, retries removal, and reveals the folder', async () => {
    let leftovers = ['agent-workspaces/n1/locked.txt (Permission denied)']
    answer({
      data_location_info: () => ({ ...INFO, isDefault: false, leftovers, previous: '/old/learn' }),
      data_location_retry_removal: () => {
        leftovers = []
        return leftovers
      },
      data_location_reveal: () => undefined,
    })
    render(<DataLocationSection />)

    const notice = await screen.findByTestId('data-location-leftovers')
    expect(notice).toHaveTextContent('one item could not be removed from the previous folder (/old/learn)')
    expect(notice).toHaveTextContent('agent-workspaces/n1/locked.txt (Permission denied)')
    await click(within(notice).getByRole('button', { name: 'Reveal in Finder' }))
    expect(invoke).toHaveBeenCalledWith('data_location_reveal', { path: '/old/learn' })
    await click(within(notice).getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.queryByTestId('data-location-leftovers')).toBeNull())
  })
})
