import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { createFakePracticeBackend, type FakePracticeBackend } from '../practice-fake-backend'
import { SANDBOX_SAVE_DELAY_MS, usePracticeStore } from '../practice-store'

import PracticeRail from './PracticeRail'

// The sandbox component (editor, runner, result pane) is its own unit with its
// own suite. Here it is a stand-in honouring the same props, so these tests
// assert what the rail owns: which node's buffer it is given and what happens
// to the edits it reports. The stand-in keeps a run result in local state, as
// the real one does, to show that result is not carried across nodes.
vi.mock('../sandbox', async () => {
  const { useState } = await import('react')
  function SandboxTool({
    nodeId,
    code,
    onCodeChange,
  }: {
    nodeId: string
    code: string
    onCodeChange: (code: string) => void
  }) {
    const [output, setOutput] = useState<string | null>(null)
    return (
      <div data-testid="sandbox-tool" data-node-id={nodeId}>
        <textarea aria-label="Code" value={code} onChange={(e) => onCodeChange(e.target.value)} />
        <button type="button" onClick={() => setOutput(`ran: ${code}`)}>
          Run
        </button>
        {output !== null && <pre data-testid="sandbox-output">{output}</pre>}
      </div>
    )
  }
  return { SandboxTool }
})

let backend: FakePracticeBackend

beforeEach(() => {
  backend = createFakePracticeBackend()
  vi.stubGlobal('fetch', vi.fn(backend.fetch))
  usePracticeStore.getState().discard()
  useWorkspaceStore.getState().reset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function openNode(nodeId: string | null) {
  act(() => {
    useWorkspaceStore.setState({ openNodeId: nodeId })
  })
}

function renderRailOn(nodeId: string) {
  openNode(nodeId)
  return render(<PracticeRail />)
}

function selectTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

describe('PracticeRail — three peer tools', () => {
  it('offers the questions tool, the code sandbox and the quiz tool, in that order', () => {
    renderRailOn('node-a')

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Q&A',
      'Code',
      'Quiz',
    ])
  })

  it('selects exactly one tool and renders only its content', async () => {
    renderRailOn('node-a')

    const selected = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true')
    expect(selected.map((tab) => tab.textContent)).toEqual(['Q&A'])
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(await screen.findByText('This node has no questions yet.')).toBeInTheDocument()
  })

  it('selecting another tool renders its content in place of the first', async () => {
    renderRailOn('node-a')

    selectTab('Quiz')

    expect(screen.getByRole('tab', { name: 'Quiz' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Q&A' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(await screen.findByText('This node has no quiz questions yet.')).toBeInTheDocument()
    expect(screen.queryByText('This node has no questions yet.')).not.toBeInTheDocument()
  })

  it('links each panel back to the tab that controls it', () => {
    renderRailOn('node-a')

    const tab = screen.getByRole('tab', { name: 'Q&A' })
    const panel = screen.getByRole('tabpanel')
    expect(tab).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', tab.id)
  })
})

describe('PracticeRail — selection is a view preference', () => {
  it("keeps the selected tool when another node opens, showing that node's material", async () => {
    backend.node('node-a').code = 'print("a")'
    backend.node('node-b').code = 'print("b")'
    renderRailOn('node-a')
    selectTab('Code')
    expect(await screen.findByDisplayValue('print("a")')).toBeInTheDocument()

    openNode('node-b')

    expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByDisplayValue('print("b")')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('print("a")')).not.toBeInTheDocument()
  })

  it('keeps the selected tool across closing a node and opening another', async () => {
    const { rerender } = renderRailOn('node-a')
    selectTab('Quiz')

    openNode(null)
    rerender(<PracticeRail />)
    openNode('node-b')
    rerender(<PracticeRail />)

    expect(screen.getByRole('tab', { name: 'Quiz' })).toHaveAttribute('aria-selected', 'true')
  })

  it('records the selection nowhere in node data', async () => {
    renderRailOn('node-a')
    await screen.findByText('This node has no questions yet.')
    const nodesBefore = useWorkspaceStore.getState().graph.nodes
    const writesBefore = backend.requests.filter((request) => request.method !== 'GET').length

    selectTab('Code')
    selectTab('Quiz')

    expect(useWorkspaceStore.getState().graph.nodes).toBe(nodesBefore)
    expect(backend.requests.filter((request) => request.method !== 'GET')).toHaveLength(writesBefore)
    expect(JSON.stringify(backend.requests)).not.toMatch(/quiz|selectedTool/i)
  })
})

describe('PracticeRail — only while a node is open', () => {
  it('renders no tools and no content with no node open', () => {
    openNode(null)
    const { container } = render(<PracticeRail />)

    expect(container).toBeEmptyDOMElement()
    expect(backend.requests).toHaveLength(0)
  })
})

describe('PracticeRail — empty states', () => {
  it('the questions tool says the node has none and offers authoring one', async () => {
    renderRailOn('node-a')

    expect(await screen.findByText('This node has no questions yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write a question' })).toBeEnabled()
  })

  it('the quiz tool says the node has none and offers authoring one', async () => {
    renderRailOn('node-a')
    selectTab('Quiz')

    expect(await screen.findByText('This node has no quiz questions yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write a quiz question' })).toBeEnabled()
  })

  it('the sandbox presents an editable empty buffer rather than an empty state', async () => {
    renderRailOn('node-a')
    selectTab('Code')

    const buffer = await screen.findByRole('textbox', { name: 'Code' })
    expect(buffer).toHaveValue('')
    expect(screen.queryByText(/no code/i)).not.toBeInTheDocument()
  })
})

describe('PracticeRail — unavailable material', () => {
  it('names what could not be loaded and offers only a retry', async () => {
    backend.failReads(true)
    renderRailOn('node-a')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("This node's practice material could not be loaded.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Write a question' })).not.toBeInTheDocument()
    expect(screen.queryByText('This node has no questions yet.')).not.toBeInTheDocument()
  })

  it('says the same in the quiz tool, and every tab stays selectable', async () => {
    backend.failReads(true)
    renderRailOn('node-a')
    await screen.findByRole('alert')

    selectTab('Quiz')
    expect(screen.getByRole('tab', { name: 'Quiz' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.queryByRole('button', { name: 'Write a quiz question' })).not.toBeInTheDocument()

    selectTab('Code')
    expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent("This node's saved code could not be loaded.")
    expect(screen.queryByRole('textbox', { name: 'Code' })).not.toBeInTheDocument()
  })

  it('a retry restores the tool without reopening the node', async () => {
    backend.failReads(true)
    renderRailOn('node-a')
    await screen.findByRole('alert')

    backend.failReads(false)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('This node has no questions yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('PracticeRail — sandbox buffer persistence', () => {
  async function typeCode(code: string) {
    fireEvent.change(await screen.findByRole('textbox', { name: 'Code' }), {
      target: { value: code },
    })
  }

  it('persists an edit without an explicit save', async () => {
    renderRailOn('node-a')
    selectTab('Code')
    await typeCode('x = 1')

    await waitFor(() => expect(backend.node('node-a').code).toBe('x = 1'), {
      timeout: SANDBOX_SAVE_DELAY_MS * 4,
    })
    const puts = backend.requestsTo('PUT', /sandbox$/)
    expect(puts[puts.length - 1]?.body).toEqual({ code: 'x = 1' })
  })

  it('flushes a pending edit when another node is opened', async () => {
    renderRailOn('node-a')
    selectTab('Code')
    await typeCode('pending = True')
    expect(backend.requestsTo('PUT', /sandbox$/)).toHaveLength(0)

    openNode('node-b')

    await waitFor(() => expect(backend.node('node-a').code).toBe('pending = True'))
    expect(backend.node('node-b').code).toBe('')
  })

  it('flushes a pending edit when the node is closed', async () => {
    const { unmount } = renderRailOn('node-a')
    selectTab('Code')
    await typeCode('closing = True')

    // The workspace unmounts the rail when the node closes.
    openNode(null)
    unmount()

    await waitFor(() => expect(backend.node('node-a').code).toBe('closing = True'))
    expect(backend.requestsTo('PUT', /sandbox$/)).toHaveLength(1)
  })

  it('restores the persisted code when the node is reopened', async () => {
    const first = renderRailOn('node-a')
    selectTab('Code')
    await typeCode('kept = 42')
    openNode(null)
    first.unmount()
    await waitFor(() => expect(backend.node('node-a').code).toBe('kept = 42'))

    // A fresh window: nothing cached, the code must come from the backend.
    usePracticeStore.getState().discard()
    usePracticeStore.getState().selectTool('sandbox')
    renderRailOn('node-a')

    expect(await screen.findByDisplayValue('kept = 42')).toBeInTheDocument()
  })

  it('shows no result from an earlier run when the node is reopened', async () => {
    backend.node('node-a').code = 'print(1)'
    renderRailOn('node-a')
    selectTab('Code')
    await screen.findByDisplayValue('print(1)')
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(screen.getByTestId('sandbox-output')).toBeInTheDocument()

    openNode('node-b')
    await screen.findByTestId('sandbox-tool')
    openNode('node-a')

    expect(await screen.findByDisplayValue('print(1)')).toBeInTheDocument()
    expect(screen.queryByTestId('sandbox-output')).not.toBeInTheDocument()
  })

  it('keeps two nodes’ buffers independent, and an unvisited node’s empty', async () => {
    renderRailOn('node-a')
    selectTab('Code')
    await typeCode('a = "A"')

    openNode('node-b')
    await screen.findByDisplayValue('')
    await typeCode('b = "B"')

    openNode('node-a')
    expect(await screen.findByDisplayValue('a = "A"')).toBeInTheDocument()

    openNode('node-c')
    await waitFor(() =>
      expect(screen.getByTestId('sandbox-tool')).toHaveAttribute('data-node-id', 'node-c'),
    )
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('')

    await waitFor(() => {
      expect(backend.node('node-a').code).toBe('a = "A"')
      expect(backend.node('node-b').code).toBe('b = "B"')
    })
    expect(backend.node('node-c').code).toBe('')
  })

  it('says so when the code could not be saved, and retries', async () => {
    renderRailOn('node-a')
    selectTab('Code')
    await screen.findByRole('textbox', { name: 'Code' })
    const realFetch = backend.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? Promise.resolve(new Response('{"detail":"down"}', { status: 503 }))
          : realFetch(url, init),
      ),
    )
    await typeCode('lost = False')

    const warning = await screen.findByText('Your code could not be saved.', undefined, {
      timeout: SANDBOX_SAVE_DELAY_MS * 4,
    })
    expect(warning).toBeInTheDocument()

    vi.stubGlobal('fetch', vi.fn(realFetch))
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }))

    await waitFor(() => expect(backend.node('node-a').code).toBe('lost = False'))
    expect(screen.queryByText('Your code could not be saved.')).not.toBeInTheDocument()
  })
})
