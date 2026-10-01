import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'

import DetailedStart from './DetailedStart'
import EmptyWorkspaceStart from './EmptyWorkspaceStart'
import QuickStartButton from './QuickStartButton'

// Some tests replace the action with a stub; every test starts from the real one.
const createRootNode = useWorkspaceStore.getState().createRootNode

beforeEach(() => {
  cleanup()
  __resetIdCounter()
  useWorkspaceStore.getState().reset()
  useWorkspaceStore.setState({ createRootNode })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function nodeCount(): number {
  return useWorkspaceStore.getState().graph.nodes.length
}

function openedNode() {
  const state = useWorkspaceStore.getState()
  return state.graph.nodes.find((node) => node.id === state.openNodeId)
}

describe('QuickStartButton', () => {
  it('creates a session without asking anything and opens it ready to write', async () => {
    const before = nodeCount()
    render(<QuickStartButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Start a new session' }))

    await waitFor(() => expect(nodeCount()).toBe(before + 1))
    expect(openedNode()).toMatchObject({ title: 'New session', titleSource: 'provisional' })
    expect(useWorkspaceStore.getState().composerFocusRequested).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sends no title and no mode', async () => {
    const spy = vi.fn(() => Promise.resolve('n-new'))
    useWorkspaceStore.setState({ createRootNode: spy })
    render(<QuickStartButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Start a new session' }))

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0]).toEqual([])
  })

  it('says why when the session could not be created', async () => {
    useWorkspaceStore.setState({
      createRootNode: () => Promise.reject(new Error('backend unreachable')),
    })
    render(<QuickStartButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Start a new session' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('backend unreachable')
  })
})

describe('DetailedStart', () => {
  function openDialog() {
    render(<DetailedStart />)
    fireEvent.click(screen.getByRole('button', { name: 'Start with a topic…' }))
    return screen.getByRole('dialog', { name: 'Start a session' })
  }

  it('asks for a topic and a mode, defaulting to Explore', () => {
    const dialog = openDialog()

    expect(within(dialog).getByLabelText('Topic')).toHaveValue('')
    expect(within(dialog).getByLabelText('Topic')).toHaveFocus()
    const mode = within(dialog).getByLabelText('Mode')
    expect(mode).toHaveValue('Explore')
    expect(within(mode).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Explore',
      'Deepen',
      'Review',
      'Practice',
      'Quiz',
    ])
  })

  it('creates a session titled with the topic in the chosen mode, and opens it', async () => {
    const dialog = openDialog()

    fireEvent.change(within(dialog).getByLabelText('Topic'), { target: { value: 'Monad laws' } })
    fireEvent.change(within(dialog).getByLabelText('Mode'), { target: { value: 'Quiz' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(openedNode()).toMatchObject({ title: 'Monad laws', titleSource: 'topic', mode: 'Quiz' })
  })

  it('falls back to automatic titling when the topic is left empty', async () => {
    const spy = vi.fn(() => Promise.resolve('n-new'))
    useWorkspaceStore.setState({ createRootNode: spy })
    const dialog = openDialog()

    fireEvent.change(within(dialog).getByLabelText('Topic'), { target: { value: '   ' } })
    fireEvent.change(within(dialog).getByLabelText('Mode'), { target: { value: 'Review' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy).toHaveBeenCalledWith({ mode: 'Review' })
  })

  it('confirms with the defaults untouched', async () => {
    const dialog = openDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(openedNode()).toMatchObject({ titleSource: 'provisional', mode: 'Explore' })
  })

  it.each([
    ['Cancel', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['the backdrop', () => fireEvent.click(screen.getByTestId('detailed-start-backdrop'))],
  ])('creates nothing when dismissed with %s', (_how, dismiss) => {
    const before = useWorkspaceStore.getState().graph
    const dialog = openDialog()
    fireEvent.change(within(dialog).getByLabelText('Topic'), { target: { value: 'Abandoned' } })

    act(() => dismiss(dialog))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useWorkspaceStore.getState().graph).toBe(before)
    expect(useWorkspaceStore.getState().openNodeId).toBeNull()
  })

  it('does not dismiss when clicking inside the dialog', () => {
    const dialog = openDialog()

    fireEvent.click(within(dialog).getByLabelText('Topic'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the dialog open and says why when creation fails', async () => {
    useWorkspaceStore.setState({ createRootNode: () => Promise.reject(new Error('refused')) })
    const dialog = openDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('refused')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('EmptyWorkspaceStart', () => {
  it('offers both the quick and the detailed start', () => {
    render(<EmptyWorkspaceStart />)

    const region = screen.getByRole('region', { name: 'Start a session' })
    expect(within(region).getByRole('button', { name: 'Start a new session' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Start with a topic…' })).toBeInTheDocument()
  })
})
