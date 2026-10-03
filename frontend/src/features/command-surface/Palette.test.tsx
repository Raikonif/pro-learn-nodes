import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../shared/lib/workspace-store'

import CommandPalette from './Palette'
import type { Command } from './types'

// The registry has its own tests; here the palette is driven by a list the
// test controls, over the real workspace store's nodes.
let registry: Command[] = []
vi.mock('./registry', () => ({ useCommands: () => registry }))

function command(id: string, title: string, extra: Partial<Command> = {}): Command {
  return { id, title, group: 'Workspace', run: vi.fn(), ...extra }
}

const NEW_SESSION = command('workspace.new-session', 'New session', { description: 'Start a session at once' })
const AGENTS = command('workspace.agents', 'Agent settings')
const BLOCKED = command('session.mode:bypass', 'Mode: Bypass', {
  group: 'Session',
  unavailable: 'Acts without asking — choose it in the session controls, where it is confirmed.',
})

/** Presses the shortcut the way the window sees it. */
function openPalette(target: Element = document.body) {
  fireEvent.keyDown(target, { key: 'k', ctrlKey: true })
}

function palette() {
  return screen.getByRole('dialog', { name: 'Command palette' })
}

function field() {
  return within(palette()).getByRole('combobox')
}

function options() {
  return within(palette()).getAllByRole('option')
}

function highlighted() {
  return options().find((option) => option.getAttribute('aria-selected') === 'true')
}

function type(text: string) {
  fireEvent.change(field(), { target: { value: text } })
}

beforeEach(() => {
  __resetIdCounter()
  useWorkspaceStore.getState().reset()
  registry = [NEW_SESSION, AGENTS, BLOCKED]
  vi.mocked(NEW_SESSION.run).mockClear()
  vi.mocked(BLOCKED.run).mockClear()
})

afterEach(cleanup)

describe('opening', () => {
  it('opens on Ctrl+K with an empty query and focus in the field', () => {
    render(<CommandPalette />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    openPalette()

    expect(palette()).toHaveAttribute('aria-modal', 'true')
    expect(field()).toHaveValue('')
    expect(field()).toHaveFocus()
  })

  it('answers Cmd+K on macOS and Ctrl+K elsewhere, not the other way round', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get')
    render(<CommandPalette />)

    platform.mockReturnValue('MacIntel')
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    expect(palette()).toBeInTheDocument()
    cleanup()

    platform.mockReturnValue('Win32')
    render(<CommandPalette />)
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    platform.mockRestore()
  })

  it('ignores K with other modifiers or no modifier', () => {
    render(<CommandPalette />)
    fireEvent.keyDown(document.body, { key: 'k' })
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, shiftKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens from the composer, consumes the keystroke and leaves the draft alone', () => {
    render(
      <>
        <textarea aria-label="Message" defaultValue="an unsent thought" />
        <CommandPalette />
      </>,
    )
    const composer = screen.getByRole('textbox', { name: 'Message' })
    composer.focus()

    const notPrevented = fireEvent.keyDown(composer, { key: 'k', ctrlKey: true })

    expect(notPrevented).toBe(false)
    expect(palette()).toBeInTheDocument()
    expect(composer).toHaveValue('an unsent thought')
  })

  it('does nothing without a mounted palette, as while signed out', () => {
    render(<div>sign in</div>)
    openPalette()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('dismissal', () => {
  it('Escape closes, runs nothing, and returns focus to what held it', () => {
    render(
      <>
        <button type="button">before</button>
        <CommandPalette />
      </>,
    )
    const before = screen.getByRole('button', { name: 'before' })
    before.focus()
    openPalette(before)
    expect(field()).toHaveFocus()

    fireEvent.keyDown(field(), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(before).toHaveFocus()
    expect(NEW_SESSION.run).not.toHaveBeenCalled()
  })

  it('closes on a backdrop click, not on a click inside the dialog, and restores focus', () => {
    render(
      <>
        <button type="button">before</button>
        <CommandPalette />
      </>,
    )
    const before = screen.getByRole('button', { name: 'before' })
    before.focus()
    openPalette(before)

    fireEvent.mouseDown(palette())
    expect(palette()).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('command-palette-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(before).toHaveFocus()
  })

  it('reopens with an empty query after a dismissed one', () => {
    render(<CommandPalette />)
    openPalette()
    type('agent')
    fireEvent.keyDown(field(), { key: 'Escape' })

    openPalette()

    expect(field()).toHaveValue('')
  })
})

describe('results', () => {
  it('labels the combobox, its listbox and the highlighted option', () => {
    render(<CommandPalette />)
    openPalette()

    const listbox = within(palette()).getByRole('listbox')
    expect(field()).toHaveAttribute('aria-controls', listbox.id)
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    expect(field()).toHaveAttribute('aria-activedescendant', highlighted()?.id)
  })

  it('lists available commands, then recent nodes, for the empty query', () => {
    render(<CommandPalette />)
    openPalette()

    const groups = within(palette()).getAllByRole('group')
    expect(groups.map((g) => g.firstElementChild?.textContent)).toEqual(['Commands', 'Nodes'])
    expect(within(groups[0]).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('New session'),
      expect.stringContaining('Agent settings'),
    ])
    expect(within(groups[1]).getByRole('option', { name: 'Haskell' })).toBeInTheDocument()
  })

  it('shows each command with its group and description', () => {
    render(<CommandPalette />)
    openPalette()

    const option = screen.getByRole('option', { name: /New session/ })
    expect(option).toHaveTextContent('Workspace')
    expect(option).toHaveTextContent('Start a session at once')
  })

  it('returns a command and a node for one query, each under its category', () => {
    registry = [command('x', 'Haskell tour')]
    render(<CommandPalette />)
    openPalette()

    type('haskell')

    const [commands, nodes] = within(palette()).getAllByRole('group')
    expect(within(commands).getByRole('option', { name: /Haskell tour/ })).toBeInTheDocument()
    expect(within(nodes).getByRole('option', { name: 'Haskell' })).toBeInTheDocument()
  })

  it('finds a command from characters that appear in order', () => {
    render(<CommandPalette />)
    openPalette()

    type('nwsn')

    expect(options()).toHaveLength(1)
    expect(options()[0]).toHaveTextContent('New session')
  })

  it('sorts an unavailable command last and shows why it cannot run', () => {
    registry = [BLOCKED, command('m', 'Mode: Default', { group: 'Session' })]
    render(<CommandPalette />)
    openPalette()

    type('mode')

    const list = options()
    expect(list[0]).toHaveTextContent('Mode: Default')
    expect(list[1]).toHaveTextContent('Mode: Bypass')
    expect(list[1]).toHaveAttribute('aria-disabled', 'true')
    expect(list[1]).toHaveTextContent('choose it in the session controls')
    expect(list[0]).not.toHaveAttribute('aria-disabled')
  })

  it('states how many more matched than are shown', () => {
    registry = Array.from({ length: 11 }, (_, i) => command(`c${i}`, `Thing ${i}`))
    render(<CommandPalette />)
    openPalette()

    expect(options().filter((o) => o.textContent?.includes('Thing'))).toHaveLength(8)
    expect(within(palette()).getByText('+3 more')).toBeInTheDocument()
  })

  it('says nothing matched, and Enter neither closes nor runs anything', () => {
    render(<CommandPalette />)
    openPalette()
    const nodesBefore = useWorkspaceStore.getState().graph.nodes.length

    type('zzzzqqq')
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(within(palette()).getByText('Nothing matched')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(field()).not.toHaveAttribute('aria-activedescendant')
    expect(useWorkspaceStore.getState().graph.nodes).toHaveLength(nodesBefore)
  })

  it('leaves out another account\'s nodes: only the store\'s graph is searched', () => {
    render(<CommandPalette />)
    openPalette()
    act(() => useWorkspaceStore.setState({ graph: { nodes: [], links: [], threads: [], messages: [], projects: [], archivedLinks: [] } }))

    type('haskell')

    expect(screen.queryByRole('option', { name: 'Haskell' })).not.toBeInTheDocument()
  })
})

describe('keyboard', () => {
  it('highlights the first result whenever the results change', () => {
    render(<CommandPalette />)
    openPalette()
    expect(highlighted()).toHaveTextContent('New session')

    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(highlighted()).toHaveTextContent('Agent settings')

    type('agent')
    expect(highlighted()).toHaveTextContent('Agent settings')
    expect(options()[0]).toBe(highlighted())
  })

  it('crosses from the last command to the first node and back', () => {
    registry = [NEW_SESSION]
    render(<CommandPalette />)
    openPalette()

    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    const [commands, nodes] = within(palette()).getAllByRole('group')
    expect(within(nodes).getAllByRole('option')[0]).toBe(highlighted())
    expect(within(commands).getAllByRole('option')[0]).not.toBe(highlighted())

    fireEvent.keyDown(field(), { key: 'ArrowUp' })
    expect(highlighted()).toHaveTextContent('New session')
  })

  it('Enter closes the palette, then runs the command on the next frame', async () => {
    render(<CommandPalette />)
    openPalette()

    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(NEW_SESSION.run).toHaveBeenCalledTimes(1))
  })

  it('Enter on a node closes the palette and opens that node', async () => {
    registry = []
    render(<CommandPalette />)
    openPalette()
    type('haskell')

    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(useWorkspaceStore.getState().openNodeId).toBe('n-haskell'))
  })

  it('Enter and click on an unavailable command do nothing and keep the palette open', async () => {
    registry = [BLOCKED]
    render(<CommandPalette />)
    openPalette()
    type('bypass')
    expect(highlighted()).toHaveTextContent('Mode: Bypass')

    fireEvent.keyDown(field(), { key: 'Enter' })
    fireEvent.click(screen.getByRole('option', { name: /Mode: Bypass/ }))
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

    expect(palette()).toBeInTheDocument()
    expect(BLOCKED.run).not.toHaveBeenCalled()
  })

  it('a click runs a command and hovering moves the highlight', async () => {
    render(<CommandPalette />)
    openPalette()

    fireEvent.mouseMove(screen.getByRole('option', { name: /Agent settings/ }))
    expect(highlighted()).toHaveTextContent('Agent settings')

    fireEvent.click(screen.getByRole('option', { name: /New session/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(NEW_SESSION.run).toHaveBeenCalledTimes(1))
  })

  it('a command that moves focus wins over the restored focus', async () => {
    const composer = document.createElement('textarea')
    document.body.append(composer)
    registry = [command('place', '/compact', { run: () => composer.focus() })]
    const before = document.createElement('button')
    document.body.append(before)
    render(<CommandPalette />)
    before.focus()
    openPalette(before)

    fireEvent.keyDown(field(), { key: 'Enter' })

    await waitFor(() => expect(composer).toHaveFocus())
    composer.remove()
    before.remove()
  })
})
