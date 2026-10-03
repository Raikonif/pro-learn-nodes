import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { usePaneLayout } from '../../shared/lib/pane-layout'
import { __resetIdCounter, useWorkspaceStore } from '../../shared/lib/workspace-store'
import { useMemoryStore } from '../memory'
import { placeInComposer } from '../node-chat'
import { useTurnStore } from '../node-chat/turn-store'
import { usePracticeStore } from '../practice/practice-store'
import { useProjectsUi } from '../projects'
import { useAgentsStore, type AgentOffer } from '../settings'
import { useLauncher } from '../study-launcher'

import { useCommands } from './registry'
import type { Command } from './types'

// Placing is observed, not performed: no composer is mounted here.
vi.mock('../node-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../node-chat')>()),
  placeInComposer: vi.fn(),
}))

const AGENT = { id: 'agent-codex', name: 'Codex', command: 'npx', args: [], env: {}, isDefault: true }

const OFFER: AgentOffer = {
  known: true,
  model: {
    id: 'model',
    name: 'Model',
    current: 'smart-1',
    values: [
      { value: 'smart-1', name: 'Smart 1', description: null },
      { value: 'smart-2', name: 'Smart 2', description: 'Newer' },
    ],
  },
  effort: { id: 'effort', name: 'Effort', current: 'low', values: [{ value: 'high', name: 'High', description: null }] },
  fast: { id: 'fast', name: 'Fast', current: 'off', values: [{ value: 'on', name: 'On', description: null }] },
  mode: {
    id: 'mode',
    name: 'Mode',
    current: 'default',
    values: [
      { value: 'default', name: 'Default', description: null, group: 'asks' },
      { value: 'edit', name: 'Edit', description: null, group: 'edits' },
      { value: 'bypass', name: 'Bypass', description: null, group: 'unasked' },
    ],
  },
  commands: [
    { name: 'compact', description: 'Compact the conversation', inputHint: null },
    { name: 'quiz', description: 'the agent\'s own quiz', inputHint: null },
    { name: 'code', description: null, inputHint: null },
    { name: '$archify', description: 'Diagrams', inputHint: 'a topic' },
  ],
}

function setOffer(offer: AgentOffer | null) {
  act(() => {
    useAgentsStore.setState({
      offers: offer ? { [AGENT.id]: { status: 'ready', offer, error: null } } : { [AGENT.id]: { status: 'loading', offer: null, error: null } },
    })
  })
}

function commands(): Command[] {
  return renderHook(() => useCommands()).result.current
}

function find(list: Command[], id: string): Command {
  const found = list.find((command) => command.id === id)
  if (!found) throw new Error(`no command ${id}`)
  return found
}

beforeEach(() => {
  __resetIdCounter()
  useWorkspaceStore.getState().reset()
  useAgentsStore.getState().discard()
  useAgentsStore.setState({ agents: [AGENT], presets: [], status: 'ready' })
  usePaneLayout.getState().reset()
  useProjectsUi.getState().close()
  usePracticeStore.getState().discard()
  useLauncher.setState({ detailedOpen: false, hosted: false })
  useMemoryStore.setState({ panelOpen: false })
  vi.mocked(placeInComposer).mockClear()
  setOffer(OFFER)
})

afterEach(cleanup)

describe('registry', () => {
  it('has unique, stable ids, with no node open and with one open', () => {
    const closed = commands().map((c) => c.id)
    expect(new Set(closed).size).toBe(closed.length)
    useWorkspaceStore.getState().openNode('n-haskell')
    const open = commands()
    expect(new Set(open.map((c) => c.id)).size).toBe(open.length)
    expect(commands().map((c) => c.id)).toEqual(open.map((c) => c.id))
  })

  it('orders groups Workspace, Projects, Practice, Session, then the agent', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const groups = commands().map((c) => c.group)
    const firsts = [...new Set(groups)]
    expect(firsts).toEqual(['Workspace', 'Projects', 'Practice', 'Session', 'Codex'])
  })
})

describe('workspace contributor', () => {
  it('starts a session exactly as the New session button does, with no arguments', () => {
    const createRootNode = vi.fn(() => Promise.resolve('n-new'))
    useWorkspaceStore.setState({ createRootNode })
    find(commands(), 'workspace.new-session').run()
    expect(createRootNode).toHaveBeenCalledWith()
  })

  it('opens the detailed start, the agents panel and memory', () => {
    const list = commands()
    act(() => find(list, 'workspace.start-with-topic').run())
    expect(useLauncher.getState().detailedOpen).toBe(true)
    act(() => find(list, 'workspace.agents').run())
    expect(useAgentsStore.getState().panelOpen).toBe(true)
    act(() => find(list, 'workspace.memory').run())
    expect(useMemoryStore.getState().panelOpen).toBe(true)
  })

  it('has one command per rail whose title follows its state', () => {
    const view = renderHook(() => useCommands())
    expect(find(view.result.current, 'workspace.toggle-node-index').title).toBe('Collapse node index')
    expect(find(view.result.current, 'workspace.toggle-workspace-tools').title).toBe('Collapse workspace tools')

    act(() => find(view.result.current, 'workspace.toggle-node-index').run())
    expect(usePaneLayout.getState().left.collapsed).toBe(true)
    expect(find(view.result.current, 'workspace.toggle-node-index').title).toBe('Expand node index')

    act(() => find(view.result.current, 'workspace.toggle-workspace-tools').run())
    expect(usePaneLayout.getState().right.collapsed).toBe(true)
    expect(find(view.result.current, 'workspace.toggle-workspace-tools').title).toBe('Expand workspace tools')
  })

  it('is available with no node open', () => {
    expect(commands().filter((c) => c.group === 'Workspace').every((c) => !c.unavailable)).toBe(true)
  })
})

describe('projects contributor', () => {
  async function withAlgebra(): Promise<string> {
    let id = ''
    await act(async () => {
      id = await useWorkspaceStore.getState().createProject('Algebra')
    })
    return id
  }

  const projectCommands = () => commands().filter((c) => c.group === 'Projects')

  it('lists show all, show each project, new project and move to each project', async () => {
    await withAlgebra()

    expect(projectCommands().map((c) => c.title)).toEqual([
      'Show all projects',
      'Show project: General',
      'Show project: Algebra',
      'New project',
      'Move session to General',
      'Move session to Algebra',
    ])
  })

  it('shows a project by setting the device filter, and all projects by clearing it', async () => {
    const id = await withAlgebra()

    const show = find(commands(), `projects.show:${id}`)
    act(() => show.run())
    expect(useWorkspaceStore.getState().projectFilter).toBe(id)
    expect(find(commands(), `projects.show:${id}`).description).toBe('Showing now')

    const showAll = find(commands(), 'projects.show-all')
    act(() => showAll.run())
    expect(useWorkspaceStore.getState().projectFilter).toBeNull()
  })

  it('opens the new project dialog', () => {
    const create = find(commands(), 'projects.new')
    act(() => create.run())

    expect(useProjectsUi.getState().dialog).toEqual({ kind: 'new' })
  })

  it('is unavailable, with the reason, to move a session when none is open', async () => {
    const id = await withAlgebra()
    const move = find(commands(), `projects.move:${id}`)

    expect(move.unavailable).toBe('Open a session first.')
    expect(find(commands(), 'projects.new').unavailable).toBeUndefined()
  })

  it('moves the open session and changes nothing else', async () => {
    const id = await withAlgebra()
    useWorkspaceStore.getState().openNode('n-haskell')
    const links = useWorkspaceStore.getState().graph.links

    const move = find(commands(), `projects.move:${id}`)
    await act(async () => move.run())

    const state = useWorkspaceStore.getState()
    expect(state.graph.nodes.find((n) => n.id === 'n-haskell')!.projectId).toBe(id)
    expect(state.graph.links).toBe(links)
    expect(state.openNodeId).toBe('n-haskell')
  })

  it('leaves an archived project out of every command', async () => {
    const id = await withAlgebra()
    await act(async () => useWorkspaceStore.getState().archiveProject(id))

    expect(projectCommands().some((c) => c.title.includes('Algebra'))).toBe(false)
  })

  it('drops a refused move without leaving an unhandled rejection', async () => {
    const id = await withAlgebra()
    useWorkspaceStore.getState().openNode('n-haskell')
    useWorkspaceStore.setState({ moveNodeToProject: () => Promise.reject(new Error('refused')) })

    expect(() => find(commands(), `projects.move:${id}`).run()).not.toThrow()
    await act(async () => {})
  })
})

describe('practice contributor', () => {
  it('is unavailable, with the reason, and does nothing when no node is open', () => {
    const list = commands().filter((c) => c.group === 'Practice')
    expect(list.map((c) => c.id)).toContain('practice.write-quiz')
    for (const command of list) expect(command.unavailable).toBe('Open a session first.')
    find(list, 'practice.write-quiz').run()
    find(list, 'practice.ask-quiz').run()
    expect(usePracticeStore.getState().authoring).toBeNull()
  })

  it('opens the learner\'s own block with its form open when a node is open', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const command = find(commands(), 'practice.write-quiz')
    expect(command.unavailable).toBeUndefined()
    act(() => command.run())
    expect(usePracticeStore.getState().authoring).toMatchObject({ nodeId: 'n-haskell', block: 'mine:quiz' })
  })

  it('places the ask entries in the composer and starts no turn', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const send = vi.spyOn(useTurnStore.getState(), 'send')
    find(commands(), 'practice.ask-qa').run()
    expect(placeInComposer).toHaveBeenCalledWith('/qa ')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('session contributor', () => {
  it('lists each control once, unavailable as needing a session, when none is open', () => {
    const list = commands().filter((c) => c.group === 'Session')
    expect(list.map((c) => c.id)).toEqual(['session.model', 'session.effort', 'session.fast', 'session.mode'])
    for (const command of list) expect(command.unavailable).toBe('Open a session first.')
  })

  it('is unavailable with the send-first reason until the agent has reported', () => {
    setOffer({ ...OFFER, known: false })
    useWorkspaceStore.getState().openNode('n-haskell')
    const list = commands().filter((c) => c.group === 'Session')
    expect(list.length).toBeGreaterThan(0)
    for (const command of list) expect(command.unavailable).toBe('Send a message first, so the agent reports what it offers.')
  })

  it('offers every model, effort and fast value, and the asking and editing modes', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const list = commands().filter((c) => c.group === 'Session')
    expect(list.map((c) => c.id)).toEqual([
      'session.model:smart-1',
      'session.model:smart-2',
      'session.effort:high',
      'session.fast:on',
      'session.mode:default',
      'session.mode:edit',
      'session.mode:bypass',
    ])
    expect(find(list, 'session.model:smart-2').title).toBe('Model: Smart 2')
    for (const id of ['session.model:smart-2', 'session.effort:high', 'session.fast:on', 'session.mode:edit']) {
      expect(find(list, id).unavailable).toBeUndefined()
    }
  })

  it('makes the choice through setNodeAgentSettings', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const save = vi.fn(() => Promise.resolve())
    useWorkspaceStore.setState({ setNodeAgentSettings: save })
    find(commands(), 'session.model:smart-2').run()
    find(commands(), 'session.mode:edit').run()
    expect(save).toHaveBeenNthCalledWith(1, 'n-haskell', { model: 'smart-2' })
    expect(save).toHaveBeenNthCalledWith(2, 'n-haskell', { mode: 'edit' })
  })

  it('lists a mode that acts without asking as unavailable, with the reason, and sets nothing', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const save = vi.fn(() => Promise.resolve())
    useWorkspaceStore.setState({ setNodeAgentSettings: save })
    const bypass = find(commands(), 'session.mode:bypass')
    expect(bypass.unavailable).toBe('Acts without asking — choose it in the session controls, where it is confirmed.')
    expect(save).not.toHaveBeenCalled()
  })

  it('marks the current choice and leaves out a control the agent does not offer', () => {
    setOffer({ ...OFFER, fast: null })
    useWorkspaceStore.getState().openNode('n-haskell')
    useWorkspaceStore.setState({
      graph: {
        ...useWorkspaceStore.getState().graph,
        nodes: useWorkspaceStore.getState().graph.nodes.map((n) => (n.id === 'n-haskell' ? { ...n, agentSettings: { model: 'smart-2' } } : n)),
      },
    })
    const list = commands()
    expect(find(list, 'session.model:smart-2').description).toBe('Current choice — Newer')
    expect(list.some((c) => c.id.startsWith('session.fast'))).toBe(false)
  })
})

describe('agent contributor', () => {
  it('lists what the agent announced under its name, as it describes them', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const list = commands().filter((c) => c.group === 'Codex')
    expect(list.map((c) => [c.id, c.title])).toEqual([
      ['agent.compact', '/compact'],
      ['agent.$archify', '/$archify'],
    ])
    expect(find(list, 'agent.compact').description).toBe('Compact the conversation')
  })

  it('leaves out the names Learn Nodes reserves', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const titles = commands().map((c) => c.title)
    expect(titles.filter((t) => t === '/quiz' || t === '/code')).toEqual([])
    expect(commands().some((c) => c.id === 'agent.quiz' || c.id === 'agent.code')).toBe(false)
  })

  it('places the command in the composer with a trailing space and never sends', () => {
    useWorkspaceStore.getState().openNode('n-haskell')
    const send = vi.spyOn(useTurnStore.getState(), 'send')
    find(commands(), 'agent.compact').run()
    find(commands(), 'agent.$archify').run()
    expect(placeInComposer).toHaveBeenNthCalledWith(1, '/compact ')
    expect(placeInComposer).toHaveBeenNthCalledWith(2, '/$archify ')
    expect(send).not.toHaveBeenCalled()
  })

  it('lists a command once even if announced twice, and nothing before the agent is known', () => {
    setOffer({ ...OFFER, commands: [OFFER.commands[0], OFFER.commands[0]] })
    useWorkspaceStore.getState().openNode('n-haskell')
    expect(commands().filter((c) => c.id === 'agent.compact')).toHaveLength(1)
    setOffer({ ...OFFER, known: false })
    expect(commands().filter((c) => c.group === 'Codex')).toEqual([])
  })

  it('has no agent commands with no node open', () => {
    expect(commands().filter((c) => c.group === 'Codex')).toEqual([])
  })
})
