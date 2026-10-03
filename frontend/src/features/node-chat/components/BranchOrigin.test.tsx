import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { messageById } from '../../../shared/lib/fixtures'
import { __resetIdCounter, useWorkspaceStore } from '../../../shared/lib/workspace-store'
import BranchOrigin from './BranchOrigin'

beforeEach(() => {
  useWorkspaceStore.getState().reset()
  __resetIdCounter()
})

describe('BranchOrigin', () => {
  it('names the parent and the passage a branched node came from, and returns to it', () => {
    const openSessionAt = vi.spyOn(useWorkspaceStore.getState(), 'openSessionAt').mockResolvedValue()
    render(<BranchOrigin nodeId="n-haskell" />)

    const origin = screen.getByTestId('branch-origin')
    expect(origin).toHaveTextContent('Branched from')
    expect(origin).toHaveTextContent('Haskell is the strictest teacher')

    fireEvent.click(screen.getByRole('button', { name: /Branched from/ }))
    const { graph } = useWorkspaceStore.getState()
    const link = graph.links.find((l) => l.childId === 'n-haskell')!
    const source = messageById(graph, link.anchor!.messageId)!
    expect(openSessionAt).toHaveBeenCalledWith('n-fp', source.threadId, source.id)
  })

  it('renders nothing for a root node', () => {
    render(<BranchOrigin nodeId="n-fp" />)
    expect(screen.queryByTestId('branch-origin')).toBeNull()
  })
})
