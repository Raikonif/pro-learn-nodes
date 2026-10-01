import { create } from 'zustand'

import { FIXTURE_GRAPH, mainThreadForNode } from './fixtures'
import {
  appendMessage,
  archiveNode as archiveNodeRequest,
  branchNode,
  createChildNode,
  createRootNode as createRootNodeRequest,
  createThread,
  loadWorkspace,
  renameNode as renameNodeRequest,
  restoreNode as restoreNodeRequest,
  saveWorkspaceContext,
  setNodeBackend,
  type WorkspaceBootstrap,
} from './workspace-api'
import type {
  ChatMessage,
  ChatThread,
  NodeLink,
  NodeMode,
  SelectionAnchor,
  WorkspaceGraph,
  WorkspaceNode,
} from './workspace-types'

const EMPTY_GRAPH: WorkspaceGraph = { nodes: [], links: [], threads: [], messages: [] }
const FIXTURE_WORKSPACE_ID = '__fixture_test_workspace__'
let viewportTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Fixture mode only: what an archive took off the graph, so a restore can put
 * it back. The real backend keeps archived nodes itself and simply leaves them
 * out of the snapshot.
 */
const fixtureArchive = new Map<string, { node: WorkspaceNode; links: NodeLink[] }>()

/** The title a session carries until its first learner message names it. */
export const PROVISIONAL_TITLE = 'New session'

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export function __resetIdCounter(): void {
  idCounter = 0
}

export type NodeOverrides = Partial<Pick<WorkspaceNode, 'title' | 'mode' | 'activeSkills' | 'mcpServers'>>
/** What a root session may be started with. Both are optional. */
export type RootSessionOptions = { title?: string; mode?: NodeMode }
type WorkspaceStatus = 'loading' | 'ready' | 'error'
type MutationResult = string | Promise<string>

export type WorkspaceState = {
  graph: WorkspaceGraph
  workspaceId: string | null
  revision: number | null
  viewport: Record<string, unknown>
  status: WorkspaceStatus
  startupError: string | null
  openNodeId: string | null
  openThreadId: string | null
  searchTerm: string
  /**
   * A request, not a state: set when a session has just been created so the
   * composer that renders for it takes focus, and consumed by that composer
   * (`consumeComposerFocus`) so a later remount does not steal focus again.
   */
  composerFocusRequested: boolean
  /**
   * A message the conversation should scroll into view and briefly highlight,
   * set when a search result is opened at a message. Cleared by the
   * conversation once the highlight has run (`clearRevealedMessage`).
   */
  revealedMessageId: string | null
  hydrate: () => Promise<void>
  openNode: (nodeId: string) => void | Promise<void>
  closeNode: () => void | Promise<void>
  openThread: (threadId: string) => void
  setSearchTerm: (term: string) => void
  setViewport: (viewport: Record<string, unknown>) => void | Promise<void>
  generateNodeFrom: (sourceNodeId: string, anchor: SelectionAnchor, overrides?: NodeOverrides) => MutationResult
  createChildNodeFrom: (parentNodeId: string) => MutationResult
  createThreadFrom: (sourceNodeId: string, anchor: SelectionAnchor, name?: string) => MutationResult
  appendMessage: (threadId: string, role: 'learner' | 'agent', content: string) => void | Promise<void>
  /** Moves a node (and every thread on it) onto another registered agent. */
  setNodeBackend: (nodeId: string, agentId: string) => void | Promise<void>
  /**
   * Folds a finished streaming turn into the recorded conversation.
   *
   * The messages are upserted by id at once — the backend recorded them
   * under the ids the stream announced, so the live turn can be dropped
   * without a flash of missing content and without ever showing a message
   * twice — and then the snapshot is re-read so the record the backend holds,
   * not the client's reconstruction of it, is what stays on screen.
   */
  settleTurn: (messages: ChatMessage[]) => void | Promise<void>
  /**
   * Starts a root session and opens it with its composer focused. Resolves to
   * the new node's id. Without a title the backend gives it a provisional one
   * that its first learner message replaces.
   */
  createRootNode: (options?: RootSessionOptions) => MutationResult
  /** Sets a learner title. An empty (or blank) title is refused. */
  renameNode: (nodeId: string, title: string) => void | Promise<void>
  /** Takes a node out of the history and the graph, deleting nothing. */
  archiveNode: (nodeId: string) => void | Promise<void>
  restoreNode: (nodeId: string) => void | Promise<void>
  /**
   * Opens a node — on a given thread of it, when named — and asks the
   * conversation to bring a message into view. How a search result is opened.
   */
  openSessionAt: (nodeId: string, threadId?: string | null, messageId?: string | null) => Promise<void>
  consumeComposerFocus: () => void
  clearRevealedMessage: () => void
  discardHydratedState: () => void
  /** Test-only fixture setup; production always hydrates through the backend. */
  reset: () => void
}

/** Everything the store holds that came from — or describes — one account. */
type WorkspaceData = Pick<
  WorkspaceState,
  | 'graph'
  | 'workspaceId'
  | 'revision'
  | 'viewport'
  | 'status'
  | 'startupError'
  | 'openNodeId'
  | 'openThreadId'
  | 'searchTerm'
  | 'composerFocusRequested'
  | 'revealedMessageId'
>

/**
 * What the store holds before any account's snapshot has been applied.
 *
 * `workspaceId: null` is the gate every mutation checks, so returning here is
 * what makes the workspace non-interactive rather than merely empty-looking.
 */
const UNHYDRATED = {
  graph: EMPTY_GRAPH,
  workspaceId: null,
  revision: null,
  viewport: {},
  status: 'loading',
  startupError: null,
  openNodeId: null,
  openThreadId: null,
  searchTerm: '',
  composerFocusRequested: false,
  revealedMessageId: null,
} satisfies WorkspaceData

function nameFromExcerpt(excerpt: string): string {
  const collapsed = excerpt.replace(/\s+/g, ' ').trim()
  return collapsed.length > 40 ? `${collapsed.slice(0, 40).trimEnd()}…` : collapsed
}

function applySnapshot(snapshot: WorkspaceBootstrap, set: (state: Partial<WorkspaceState>) => void): void {
  // A saved context can name a node the snapshot no longer carries — one that
  // has since been archived. Opening nothing beats opening a node that is not
  // there to show.
  const lastOpen = snapshot.graph.nodes.some((node) => node.id === snapshot.context.lastOpenNodeId)
    ? snapshot.context.lastOpenNodeId
    : null
  const main = lastOpen ? mainThreadForNode(snapshot.graph, lastOpen) : undefined
  set({
    graph: snapshot.graph,
    workspaceId: snapshot.workspaceId,
    revision: snapshot.revision,
    viewport: snapshot.context.viewport,
    openNodeId: lastOpen,
    openThreadId: main?.id ?? null,
    status: 'ready',
    startupError: null,
  })
}

/**
 * Applies a snapshot's graph without touching what is open.
 *
 * For re-reads that happen underneath the learner (a turn settling, a backend
 * change): `applySnapshot` restores the saved context, which would pull a
 * learner reading a spawned thread back to the node's main thread.
 */
function applyGraph(
  snapshot: WorkspaceBootstrap,
  get: () => WorkspaceState,
  set: (state: Partial<WorkspaceState>) => void,
): void {
  const state = get()
  // The account changed while the request was in flight: this snapshot
  // belongs to a workspace the window no longer holds.
  if (state.workspaceId !== snapshot.workspaceId) return
  // The open node itself can leave the snapshot — archiving it does that —
  // and then there is nothing left to hold open.
  const nodeStillThere = snapshot.graph.nodes.some((node) => node.id === state.openNodeId)
  const openNodeId = nodeStillThere ? state.openNodeId : null
  const threadStillThere =
    openNodeId !== null &&
    snapshot.graph.threads.some((t) => t.id === state.openThreadId && t.nodeId === openNodeId)
  const fallback = openNodeId ? mainThreadForNode(snapshot.graph, openNodeId) : undefined
  set({
    graph: snapshot.graph,
    revision: snapshot.revision,
    openNodeId,
    openThreadId: threadStillThere ? state.openThreadId : (fallback?.id ?? null),
  })
}

/**
 * The node a creation added: the one the previous graph did not have. Newest
 * `createdAt` breaks a tie, in case a concurrent write added another.
 */
function createdNode(snapshot: WorkspaceBootstrap, existing: Set<string>): WorkspaceNode | undefined {
  return snapshot.graph.nodes
    .filter((node) => !existing.has(node.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

function upsertMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(incoming.map((message) => [message.id, message]))
  const merged = existing.map((message) => byId.get(message.id) ?? message)
  const present = new Set(existing.map((message) => message.id))
  return [...merged, ...incoming.filter((message) => !present.has(message.id))]
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...UNHYDRATED,

  hydrate: async () => {
    set({ status: 'loading', startupError: null })
    try {
      applySnapshot(await loadWorkspace(), set)
    } catch (error) {
      set({ status: 'error', startupError: (error as Error).message })
    }
  },

  openNode: (nodeId) => {
    const state = get()
    const main = mainThreadForNode(state.graph, nodeId)
    if (!main) throw new Error(`Cannot open unknown node: ${nodeId}`)
    if (state.workspaceId === FIXTURE_WORKSPACE_ID) {
      const now = new Date().toISOString()
      set({
        openNodeId: nodeId,
        openThreadId: main.id,
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.map((node) =>
            node.id === nodeId ? { ...node, lastOpenedAt: now, lastActivityAt: now } : node,
          ),
        },
      })
      return
    }
    if (!state.workspaceId) return
    return saveWorkspaceContext(nodeId, state.viewport).then((snapshot) =>
      applySnapshot(snapshot, set),
    )
  },

  closeNode: () => {
    const state = get()
    if (state.workspaceId === FIXTURE_WORKSPACE_ID) {
      set({ openNodeId: null, openThreadId: null })
      return
    }
    if (!state.workspaceId) return
    return saveWorkspaceContext(null, state.viewport).then((snapshot) =>
      applySnapshot(snapshot, set),
    )
  },

  openThread: (threadId) => set({ openThreadId: threadId }),
  setSearchTerm: (term) => set({ searchTerm: term }),

  setViewport: (viewport) => {
    const state = get()
    if (state.workspaceId === FIXTURE_WORKSPACE_ID) {
      set({ viewport })
      return
    }
    if (!state.workspaceId) return
    set({ viewport })
    if (viewportTimer) clearTimeout(viewportTimer)
    viewportTimer = setTimeout(() => {
      const current = get()
      if (!current.workspaceId || current.workspaceId === FIXTURE_WORKSPACE_ID) return
      void saveWorkspaceContext(current.openNodeId, current.viewport).then((snapshot) =>
        applySnapshot(snapshot, set),
      )
    }, 250)
  },

  generateNodeFrom: (sourceNodeId, anchor, overrides) => {
    const state = get()
    // Ahead of the graph lookup: nothing is hydrated means the graph is empty,
    // so "unknown node" would blame the argument for a refusal that is really
    // about the workspace not belonging to anyone yet.
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    const source = state.graph.nodes.find((node) => node.id === sourceNodeId)
    if (!source) throw new Error(`Cannot branch from unknown node: ${sourceNodeId}`)
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      const existing = new Set(state.graph.nodes.map((node) => node.id))
      return branchNode(sourceNodeId, anchor, overrides).then((snapshot) => {
        const node = snapshot.graph.nodes.find((candidate) => !existing.has(candidate.id))
        applySnapshot(snapshot, set)
        if (!node) throw new Error('Backend did not return the new node')
        return node.id
      })
    }
    const now = new Date().toISOString()
    const nodeId = nextId('n')
    const node: WorkspaceNode = {
      id: nodeId,
      title: overrides?.title ?? nameFromExcerpt(anchor.excerpt),
      mode: overrides?.mode ?? source.mode,
      activeSkills: overrides?.activeSkills ?? [...source.activeSkills],
      mcpServers: overrides?.mcpServers ?? [...source.mcpServers],
      backendAgentId: source.backendAgentId,
      body: '',
      createdAt: now,
      lastOpenedAt: now,
      lastActivityAt: now,
      titleSource: 'topic',
    }
    const main: ChatThread = { id: nextId('t'), nodeId, name: 'main', anchor: null }
    set({
      graph: {
        ...state.graph,
        nodes: [...state.graph.nodes, node],
        links: [...state.graph.links, { id: nextId('l'), parentId: sourceNodeId, childId: nodeId, anchor }],
        threads: [...state.graph.threads, main],
      },
    })
    return nodeId
  },

  createChildNodeFrom: (parentNodeId) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    const parent = state.graph.nodes.find((node) => node.id === parentNodeId)
    if (!parent) throw new Error(`Cannot create a child from unknown node: ${parentNodeId}`)
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      const existing = new Set(state.graph.nodes.map((node) => node.id))
      return createChildNode(parentNodeId).then((snapshot) => {
        const node = snapshot.graph.nodes.find((candidate) => !existing.has(candidate.id))
        applySnapshot(snapshot, set)
        if (!node) throw new Error('Backend did not return the new node')
        return node.id
      })
    }
    const now = new Date().toISOString()
    const nodeId = nextId('n')
    const main: ChatThread = { id: nextId('t'), nodeId, name: 'main', anchor: null }
    const node: WorkspaceNode = {
      id: nodeId,
      title: `New child of ${parent.title}`,
      mode: parent.mode,
      activeSkills: [...parent.activeSkills],
      mcpServers: [...parent.mcpServers],
      backendAgentId: parent.backendAgentId,
      body: '',
      createdAt: now,
      lastOpenedAt: now,
      lastActivityAt: now,
      titleSource: 'topic',
    }
    set({
      graph: {
        ...state.graph,
        nodes: [...state.graph.nodes, node],
        links: [...state.graph.links, { id: nextId('l'), parentId: parentNodeId, childId: nodeId, anchor: null }],
        threads: [...state.graph.threads, main],
      },
      openNodeId: nodeId,
      openThreadId: main.id,
    })
    return nodeId
  },

  createThreadFrom: (sourceNodeId, anchor, name) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    if (!state.graph.nodes.some((node) => node.id === sourceNodeId)) {
      throw new Error(`Cannot create a thread on unknown node: ${sourceNodeId}`)
    }
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      const existing = new Set(state.graph.threads.map((thread) => thread.id))
      return createThread(sourceNodeId, anchor, name).then((snapshot) => {
        const thread = snapshot.graph.threads.find((candidate) => !existing.has(candidate.id))
        applySnapshot(snapshot, set)
        if (!thread) throw new Error('Backend did not return the new thread')
        return thread.id
      })
    }
    const thread: ChatThread = {
      id: nextId('t'),
      nodeId: sourceNodeId,
      name: name ?? nameFromExcerpt(anchor.excerpt),
      anchor,
    }
    set({ graph: { ...state.graph, threads: [...state.graph.threads, thread] } })
    return thread.id
  },

  appendMessage: (threadId, role, content) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    if (!state.graph.threads.some((thread) => thread.id === threadId)) {
      throw new Error(`Cannot add a message to unknown thread: ${threadId}`)
    }
    if (!content.trim()) throw new Error('Cannot add an empty message')
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      return appendMessage(threadId, role, content).then((snapshot) =>
        applySnapshot(snapshot, set),
      )
    }
    set({
      graph: {
        ...state.graph,
        messages: [
          ...state.graph.messages,
          {
            id: nextId('m'),
            threadId,
            role,
            content,
            createdAt: new Date().toISOString(),
            kind: 'message',
            outcome: role === 'agent' ? 'completed' : null,
            data: null,
          },
        ],
      },
    })
  },

  setNodeBackend: (nodeId, agentId) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    if (!state.graph.nodes.some((node) => node.id === nodeId)) {
      throw new Error(`Cannot change the backend of unknown node: ${nodeId}`)
    }
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      return setNodeBackend(nodeId, agentId).then((snapshot) => applyGraph(snapshot, get, set))
    }
    set({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) =>
          node.id === nodeId ? { ...node, backendAgentId: agentId } : node,
        ),
      },
    })
  },

  settleTurn: (messages) => {
    const state = get()
    if (!state.workspaceId) return
    if (messages.length > 0) {
      set({ graph: { ...state.graph, messages: upsertMessages(state.graph.messages, messages) } })
    }
    if (state.workspaceId === FIXTURE_WORKSPACE_ID) return
    return loadWorkspace().then((snapshot) => applyGraph(snapshot, get, set))
  },

  createRootNode: (options = {}) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    const title = options.title?.trim() ?? ''
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      const existing = new Set(state.graph.nodes.map((node) => node.id))
      return createRootNodeRequest({ title, mode: options.mode }).then(async (snapshot) => {
        const node = createdNode(snapshot, existing)
        applyGraph(snapshot, get, set)
        if (!node) throw new Error('Backend did not return the new node')
        // Opening goes through the context route like any other open, so the
        // new session is also the one a restart comes back to.
        await get().openNode(node.id)
        set({ composerFocusRequested: true })
        return node.id
      })
    }
    const now = new Date().toISOString()
    const nodeId = nextId('n')
    const main: ChatThread = { id: nextId('t'), nodeId, name: 'main', anchor: null }
    const node: WorkspaceNode = {
      id: nodeId,
      title: title || PROVISIONAL_TITLE,
      titleSource: title ? 'topic' : 'provisional',
      mode: options.mode ?? 'Explore',
      activeSkills: [],
      mcpServers: [],
      backendAgentId: null,
      body: '',
      createdAt: now,
      lastOpenedAt: now,
      lastActivityAt: now,
    }
    set({
      graph: {
        ...state.graph,
        nodes: [...state.graph.nodes, node],
        threads: [...state.graph.threads, main],
      },
      openNodeId: nodeId,
      openThreadId: main.id,
      composerFocusRequested: true,
    })
    return nodeId
  },

  renameNode: (nodeId, title) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    if (!state.graph.nodes.some((node) => node.id === nodeId)) {
      throw new Error(`Cannot rename unknown node: ${nodeId}`)
    }
    const trimmed = title.trim()
    if (!trimmed) throw new Error('A session title cannot be empty')
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      return renameNodeRequest(nodeId, trimmed).then((snapshot) => applyGraph(snapshot, get, set))
    }
    set({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) =>
          node.id === nodeId ? { ...node, title: trimmed, titleSource: 'learner' } : node,
        ),
      },
    })
  },

  archiveNode: (nodeId) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    const node = state.graph.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`Cannot archive unknown node: ${nodeId}`)
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      return archiveNodeRequest(nodeId).then((snapshot) => applyGraph(snapshot, get, set))
    }
    // Links touching the node leave with it; its children stay, unlinked.
    const touching = (link: NodeLink) => link.parentId === nodeId || link.childId === nodeId
    fixtureArchive.set(nodeId, { node, links: state.graph.links.filter(touching) })
    const closing = state.openNodeId === nodeId
    set({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.filter((candidate) => candidate.id !== nodeId),
        links: state.graph.links.filter((link) => !touching(link)),
      },
      ...(closing ? { openNodeId: null, openThreadId: null } : {}),
    })
  },

  restoreNode: (nodeId) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      return restoreNodeRequest(nodeId).then((snapshot) => applyGraph(snapshot, get, set))
    }
    const archived = fixtureArchive.get(nodeId)
    if (!archived) throw new Error(`Cannot restore a node that is not archived: ${nodeId}`)
    fixtureArchive.delete(nodeId)
    const present = new Set(state.graph.nodes.map((node) => node.id))
    present.add(nodeId)
    set({
      graph: {
        ...state.graph,
        nodes: [...state.graph.nodes, archived.node],
        // A link whose other end was archived meanwhile stays off the graph.
        links: [
          ...state.graph.links,
          ...archived.links.filter((link) => present.has(link.parentId) && present.has(link.childId)),
        ],
      },
    })
  },

  openSessionAt: async (nodeId, threadId, messageId) => {
    await get().openNode(nodeId)
    const state = get()
    if (state.openNodeId !== nodeId) return
    if (threadId && state.graph.threads.some((t) => t.id === threadId && t.nodeId === nodeId)) {
      state.openThread(threadId)
    }
    // Only a message the open thread actually shows: a stale request would
    // otherwise linger and scroll the learner somewhere later, unasked.
    const openThreadId = get().openThreadId
    const shown = get().graph.messages.some((m) => m.id === messageId && m.threadId === openThreadId)
    set({ revealedMessageId: shown ? (messageId ?? null) : null })
  },

  consumeComposerFocus: () => set({ composerFocusRequested: false }),
  clearRevealedMessage: () => set({ revealedMessageId: null }),

  /**
   * Drops everything the store holds on behalf of an account.
   *
   * Called when the active account changes — including to nobody. Emptying the
   * graph is the visible half; nulling `workspaceId` is the half that matters,
   * because that is what every mutation checks, so the workspace stays
   * non-interactive until the next account's snapshot has been validated and
   * applied. The pending viewport save is cancelled with it: a debounced write
   * that survived the switch would carry one account's camera position into
   * another's workspace.
   */
  discardHydratedState: () => {
    if (viewportTimer) clearTimeout(viewportTimer)
    viewportTimer = undefined
    set({ ...UNHYDRATED })
  },

  reset: () => {
    fixtureArchive.clear()
    set({
      graph: FIXTURE_GRAPH,
      workspaceId: FIXTURE_WORKSPACE_ID,
      revision: 0,
      viewport: {},
      status: 'ready',
      startupError: null,
      openNodeId: null,
      openThreadId: null,
      searchTerm: '',
      composerFocusRequested: false,
      revealedMessageId: null,
    })
  },
}))

/**
 * Every session in the snapshot, most recent activity first.
 *
 * Not filtered by `searchTerm`: search matches message content as well as
 * titles, which only the backend's index can answer, so the rail asks it
 * (`searchSessions`) rather than narrowing this list.
 */
export function selectRecents(state: WorkspaceState): WorkspaceNode[] {
  return [...state.graph.nodes].sort(
    (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
  )
}
