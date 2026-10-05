import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { useCodeViewerStore } from '../code-viewer-store'
import * as api from '../code-viewer-api'
import { MessageText, OpenInCodeActions } from './MessageText'
import NodeCenterTabs from './NodeCenterTabs'

vi.mock('../code-viewer-api', async (original) => ({
  ...(await original<typeof import('../code-viewer-api')>()),
  listCodeFiles: vi.fn(),
  readCodeFile: vi.fn(),
}))

const listCodeFiles = vi.mocked(api.listCodeFiles)
const readCodeFile = vi.mocked(api.readCodeFile)

const FENCED = 'Try this:\n```python\nfor i in range(3):\n    print(i)\n```\nThen run it.'

function addAgentMessage(content: string) {
  useWorkspaceStore.setState((state) => ({
    graph: {
      ...state.graph,
      messages: [
        ...state.graph.messages,
        {
          ...state.graph.messages.find((m) => m.role === 'agent')!,
          id: 'm-code',
          threadId: 't-haskell-main',
          content,
        },
      ],
    },
  }))
}

function renderTabs({ running = false, exercises = [] as { id: string; prompt: string; solution: string }[] } = {}) {
  return render(
    <NodeCenterTabs
      turnRunning={running}
      exercises={exercises}
      conversation={<p data-testid="conversation-body">The conversation</p>}
    />,
  )
}

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  useCodeViewerStore.getState().discard()
  __resetIdCounter()
  listCodeFiles.mockReset().mockResolvedValue([])
  readCodeFile.mockReset()
  useWorkspaceStore.getState().openNode('n-haskell')
})

describe('NodeCenterTabs', () => {
  it('offers no Code tab for a node without code', async () => {
    renderTabs()
    await waitFor(() => expect(listCodeFiles).toHaveBeenCalledWith('n-haskell'))

    expect(screen.queryByRole('tab', { name: /Code/ })).toBeNull()
    expect(screen.getByTestId('conversation-body')).toBeVisible()
  })

  it('offers the tab once the agent has written a file, starting on the conversation', async () => {
    listCodeFiles.mockResolvedValue([{ path: 'loops.py', size: 20, language: 'python', viewable: true, reason: null }])
    readCodeFile.mockResolvedValue({ status: 'ready', content: 'for i in range(3):\n    print(i)\n' })
    renderTabs()

    const codeTab = await screen.findByRole('tab', { name: /Code/ })
    expect(screen.getByRole('tab', { name: /Conversation/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(codeTab)
    expect(await screen.findByRole('figure', { name: 'loops.py' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Code sources' }).textContent).toContain("Files in this node's folder")
    // Still mounted, only hidden: a turn keeps streaming into it.
    expect(screen.getByTestId('conversation-body')).not.toBeVisible()
  })

  it('lists files, exercises and conversation blocks in their own groups', async () => {
    listCodeFiles.mockResolvedValue([
      { path: 'big.log.txt', size: 5_000_000, language: null, viewable: false, reason: 'too_large' },
    ])
    addAgentMessage(FENCED)
    renderTabs({ exercises: [{ id: 'ex1', prompt: 'Print 0 to 2', solution: 'print(0)' }] })

    fireEvent.click(await screen.findByRole('tab', { name: /Code \(3\)/ }))
    const sources = screen.getByRole('navigation', { name: 'Code sources' })
    expect(sources.textContent).toContain('Practice exercises')
    expect(sources.textContent).toContain('From the conversation')
    // A file that cannot be viewed is listed with its reason, not opened by default.
    expect(screen.getByRole('figure', { name: 'Print 0 to 2 — your solution' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /big\.log\.txt/ }))
    expect(screen.getByText('Too large to view (over 1 MB).')).toBeInTheDocument()
  })

  it('marks the conversation tab while a turn runs and keeps the conversation mounted', async () => {
    addAgentMessage(FENCED)
    const view = renderTabs({ running: true })
    fireEvent.click(await screen.findByRole('tab', { name: /Code/ }))

    expect(screen.getByTestId('conversation-running')).toHaveTextContent('turn in progress')
    expect(screen.getByTestId('conversation-body')).toBeInTheDocument()

    listCodeFiles.mockClear()
    view.rerender(
      <NodeCenterTabs turnRunning={false} exercises={[]} conversation={<p data-testid="conversation-body">x</p>} />,
    )
    // A finished turn is when an agent may have written files: the folder is read again.
    await waitFor(() => expect(listCodeFiles).toHaveBeenCalledWith('n-haskell'))
  })

  it('opens a conversation block in the Code tab from "Open in Code"', async () => {
    addAgentMessage(FENCED)
    render(
      <>
        <OpenInCodeActions nodeId="n-haskell" messageId="m-code" text={FENCED} />
        <NodeCenterTabs turnRunning={false} exercises={[]} conversation={<p>conversation</p>} />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Python in Code' }))

    expect(await screen.findByRole('tab', { name: /Code/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('figure').getAttribute('data-language')).toBe('python')
    expect(screen.getByRole('figure').textContent).toContain('print(i)')
  })

  it('starts another node on its conversation', async () => {
    addAgentMessage(FENCED)
    renderTabs()
    fireEvent.click(await screen.findByRole('tab', { name: /Code/ }))
    act(() => useWorkspaceStore.getState().openNode('n-haskell'))
    act(() => useCodeViewerStore.setState({ tab: { nodeId: 'another-node', tab: 'code' } }))

    expect(screen.getByRole('tab', { name: /Conversation/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('MessageText', () => {
  it('colours a fenced block without changing the message text', () => {
    const { container } = render(
      <p data-testid="content">
        <MessageText text={FENCED} />
      </p>,
    )

    expect(screen.getByTestId('content').textContent).toBe(FENCED)
    expect(container.querySelector('[data-testid="message-code-block"] .tok-keyword')?.textContent).toBe('for')
  })

  it('leaves text without fences as it is', () => {
    render(
      <p data-testid="content">
        <MessageText text="no code here" />
      </p>,
    )
    expect(screen.getByTestId('content').textContent).toBe('no code here')
    expect(screen.queryByTestId('message-code-block')).toBeNull()
  })

  it('keeps a still-streaming, unclosed block exact', () => {
    const streaming = 'Here:\n```js\nconst a = 1\n'
    render(
      <p data-testid="content">
        <MessageText text={streaming} />
      </p>,
    )
    expect(screen.getByTestId('content').textContent).toBe(streaming)
  })
})
