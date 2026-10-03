import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { FIXTURE_DEFAULT_PROJECT_ID } from '../../../shared/lib/fixtures'
import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { useProjectsUi } from '../projects-ui-store'

import ProjectDialogHost from './ProjectDialogHost'
import ProjectsPanel from './ProjectsPanel'

const GENERAL = FIXTURE_DEFAULT_PROJECT_ID

// One test replaces this action with a failing stub; every test starts from the real one.
const archiveProject = useWorkspaceStore.getState().archiveProject

function store() {
  return useWorkspaceStore.getState()
}

beforeEach(() => {
  cleanup()
  __resetIdCounter()
  window.localStorage.clear()
  store().reset()
  useWorkspaceStore.setState({ archiveProject })
  useProjectsUi.getState().close()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderPanel() {
  return render(
    <>
      <ProjectsPanel />
      <ProjectDialogHost />
    </>,
  )
}

async function makeProject(name: string): Promise<string> {
  let id = ''
  await act(async () => {
    id = await store().createProject(name)
  })
  return id
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
}

describe('the project filter', () => {
  it('lists all projects first, then each project, and filters the store', async () => {
    const algebra = await makeProject('Algebra')
    renderPanel()

    const select = screen.getByLabelText('Project')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All projects',
      'General',
      'Algebra',
    ])
    expect(select).toHaveValue('')

    fireEvent.change(select, { target: { value: algebra } })
    expect(store().projectFilter).toBe(algebra)

    fireEvent.change(select, { target: { value: '' } })
    expect(store().projectFilter).toBeNull()
  })

  it('shows the remembered project selected, and all projects when it is gone', async () => {
    const id = await makeProject('Algebra')
    act(() => store().setProjectFilter(id))
    renderPanel()
    expect(screen.getByLabelText('Project')).toHaveValue(id)

    await act(async () => store().deleteProject(id))
    expect(screen.getByLabelText('Project')).toHaveValue('')
  })

  it('changes no session', async () => {
    const id = await makeProject('Algebra')
    const graph = store().graph
    renderPanel()

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: id } })

    expect(store().graph).toBe(graph)
  })
})

describe('the management menu', () => {
  it('is collapsed until asked for, and offers a new project', () => {
    renderPanel()
    expect(screen.queryByRole('group', { name: 'Manage projects' })).not.toBeInTheDocument()

    openMenu()

    expect(screen.getByRole('button', { name: 'Manage' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'New project…' }))
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument()
  })

  it('creates a project from the dialog, and refuses an empty name', async () => {
    renderPanel()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New project…' }))
    const dialog = screen.getByRole('dialog', { name: 'New project' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('cannot be empty')
    expect(store().graph.projects).toHaveLength(1)

    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Algebra' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(store().graph.projects.map((p) => p.name)).toEqual(['General', 'Algebra'])
  })

  it('says to choose a project while all are shown', () => {
    renderPanel()
    openMenu()

    expect(screen.getByText(/Choose a project above/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Archive project/ })).not.toBeInTheDocument()
  })

  it('renames the filtered project', async () => {
    const id = await makeProject('Algebra')
    act(() => store().setProjectFilter(id))
    renderPanel()
    openMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Rename project Algebra' }))
    const dialog = screen.getByRole('dialog', { name: 'Rename Algebra' })
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Algebra II' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(store().graph.projects.find((p) => p.id === id)!.name).toBe('Algebra II')
  })

  it('edits the instructions in a dialog over the workspace', async () => {
    const id = await makeProject('Algebra')
    act(() => store().setProjectFilter(id))
    renderPanel()
    openMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Edit instructions of Algebra' }))
    const dialog = screen.getByRole('dialog', { name: 'Instructions for Algebra' })
    fireEvent.change(within(dialog).getByLabelText('Instructions'), { target: { value: 'Use Lean.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(store().graph.projects.find((p) => p.id === id)!.instructions).toBe('Use Lean.')
  })

  it('archives the filtered project at once, and returns to all projects', async () => {
    const id = await makeProject('Algebra')
    act(() => store().setProjectFilter(id))
    renderPanel()
    openMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Archive project Algebra' }))

    await waitFor(() => expect(store().graph.projects.map((p) => p.id)).toEqual([GENERAL]))
    expect(store().projectFilter).toBeNull()
  })

  it('shows a refusal from archiving instead of failing silently', async () => {
    const id = await makeProject('Algebra')
    act(() => store().setProjectFilter(id))
    useWorkspaceStore.setState({ archiveProject: () => Promise.reject(new Error('Not today')) })
    renderPanel()
    openMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Archive project Algebra' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not today')
  })

  it('states, before deleting, that the sessions move to the default project', async () => {
    const id = await makeProject('Algebra')
    await act(async () => store().moveNodeToProject('n-haskell', id))
    act(() => store().setProjectFilter(id))
    renderPanel()
    openMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Delete project Algebra' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Algebra?' })

    expect(dialog).toHaveTextContent('move to the default project (General)')
    expect(dialog).toHaveTextContent('No session is deleted')
    // Nothing happens until confirmed.
    expect(store().graph.projects).toHaveLength(2)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(store().graph.projects.map((p) => p.id)).toEqual([GENERAL])
    expect(store().graph.nodes.find((n) => n.id === 'n-haskell')!.projectId).toBe(GENERAL)
  })

  it('cancelling the delete leaves the project', async () => {
    const id = await makeProject('Algebra')
    act(() => store().setProjectFilter(id))
    renderPanel()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete project Algebra' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(store().graph.projects).toHaveLength(2)
  })

  it('gives the default project no archive or delete, and says why', () => {
    act(() => store().setProjectFilter(GENERAL))
    renderPanel()
    openMenu()

    expect(screen.queryByRole('button', { name: /Archive project/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete project/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('default-project-reason')).toHaveTextContent(
      'where sessions without a project go',
    )
    // It can still be renamed and given instructions.
    expect(screen.getByRole('button', { name: 'Rename project General' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit instructions of General' })).toBeInTheDocument()
  })

  it('adds no pane: the dialogs are overlays and the menu is inline', async () => {
    const id = await makeProject('Algebra')
    act(() => store().setProjectFilter(id))
    const { container } = renderPanel()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete project Algebra' }))

    expect(screen.getByTestId('project-dialog-backdrop')).toHaveClass('fixed', 'inset-0')
    expect(container.querySelector('aside, main')).toBeNull()
  })
})

describe('archived projects', () => {
  async function archiveAlgebra(): Promise<string> {
    const id = await makeProject('Algebra')
    await act(async () => store().moveNodeToProject('n-haskell', id))
    await act(async () => store().moveNodeToProject('n-functors', id))
    await act(async () => store().archiveProject(id))
    return id
  }

  it('lists each with its number of sessions and restores it', async () => {
    const id = await archiveAlgebra()
    renderPanel()
    openMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Archived projects' }))

    const entry = await screen.findByTestId('archived-project')
    expect(entry).toHaveTextContent('Algebra')
    expect(entry).toHaveTextContent('2 sessions')

    fireEvent.click(within(entry).getByRole('button', { name: 'Restore project Algebra' }))

    await waitFor(() => expect(store().graph.projects.map((p) => p.id)).toContain(id))
    expect(await screen.findByText('No archived projects.')).toBeInTheDocument()
    expect(store().graph.nodes.map((n) => n.id)).toContain('n-haskell')
  })

  it('offers the archived project nowhere else in the panel', async () => {
    await archiveAlgebra()
    renderPanel()

    expect(within(screen.getByLabelText('Project')).queryByRole('option', { name: 'Algebra' })).toBeNull()
  })

  it('says so when nothing is archived', async () => {
    renderPanel()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Archived projects' }))

    expect(await screen.findByText('No archived projects.')).toBeInTheDocument()
  })
})
