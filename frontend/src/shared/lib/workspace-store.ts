import { create } from 'zustand'

import { FIXTURE_GRAPH, mainThreadForNode } from './fixtures'
import {
  appendMessage,
  archiveNode as archiveNodeRequest,
  archiveProject as archiveProjectRequest,
  branchNode,
  createChildNode,
  createProject as createProjectRequest,
  createRootNode as createRootNodeRequest,
  createThread,
  deleteProject as deleteProjectRequest,
  loadArchivedProjects,
  loadWorkspace,
  moveNodeToProject as moveNodeToProjectRequest,
  renameNode as renameNodeRequest,
  restoreNode as restoreNodeRequest,
  restoreProject as restoreProjectRequest,
  saveWorkspaceContext,
  setNodeAgentSettings as setNodeAgentSettingsRequest,
  setNodeBackend,
  updateProject as updateProjectRequest,
  type AgentSettingsPatch,
  type ArchivedProject,
  type WorkspaceBootstrap,
} from './workspace-api'
import type {
  ArchivedLink,
  ChatMessage,
  ChatThread,
  NodeLink,
  NodeMode,
  Project,
  SelectionAnchor,
  WorkspaceGraph,
  WorkspaceNode,
} from './workspace-types'

const EMPTY_GRAPH: WorkspaceGraph = {
  nodes: [],
  links: [],
  threads: [],
  messages: [],
  projects: [],
  archivedLinks: [],
}
const FIXTURE_WORKSPACE_ID = '__fixture_test_workspace__'
let viewportTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Fixture mode only: what an archive took off the graph, so a restore can put
 * it back. The real backend keeps archived nodes itself and simply leaves them
 * out of the snapshot.
 */
const fixtureArchive = new Map<
  string,
  { node: WorkspaceNode; links: NodeLink[]; withProject: string | null }
>()

/** Fixture mode only: archived projects, for the archived list and for a restore. */
const fixtureArchivedProjects = new Map<string, { project: Project; archivedAt: string }>()

export const PROJECT_FILTER_STORAGE_KEY = 'learn-nodes.project-filter'

/**
 * The project the history is narrowed to on this device, or `null` for all.
 *
 * A view preference like the pane layout, so it lives in `localStorage` and
 * every read and write is guarded: a storage failure leaves the history
 * showing every project rather than breaking the workspace.
 */
export function readStoredProjectFilter(): string | null {
  try {
    const raw = window.localStorage.getItem(PROJECT_FILTER_STORAGE_KEY)
    return raw ? raw : null
  } catch {
    return null
  }
}

function writeStoredProjectFilter(projectId: string | null): void {
  try {
    if (projectId) window.localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, projectId)
    else window.localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY)
  } catch {
    // A preference that cannot be stored is simply not remembered.
  }
}

/**
 * A filter naming a project the snapshot does not carry — one deleted,
 * archived, or belonging to another account — falls back to all projects:
 * a history filtered to nothing would look like a history with no sessions.
 */
function validFilter(filter: string | null, graph: WorkspaceGraph): string | null {
  return filter !== null && graph.projects.some((project) => project.id === filter) ? filter : null
}

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

export type NodeOverrides = Partial<Pick<WorkspaceNode, 'title' | 'mode' | 'activeSkills' | 'mcpServers'>> & {
  /** Create the branch in this project instead of its source's. */
  projectId?: string
}
/**
 * What a root session may be started with; all optional. Without a project the
 * session joins the one the history is filtered to, else the default project.
 */
export type RootSessionOptions = { title?: string; mode?: NodeMode; projectId?: string }
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
   * The project the history is narrowed to, or `null` for all. View state of
   * this device: it changes no node, and the canvas and search ignore it.
   */
  projectFilter: string | null
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
  setProjectFilter: (projectId: string | null) => void
  setViewport: (viewport: Record<string, unknown>) => void | Promise<void>
  generateNodeFrom: (sourceNodeId: string, anchor: SelectionAnchor, overrides?: NodeOverrides) => MutationResult
  createChildNodeFrom: (parentNodeId: string) => MutationResult
  createThreadFrom: (sourceNodeId: string, anchor: SelectionAnchor, name?: string) => MutationResult
  appendMessage: (threadId: string, role: 'learner' | 'agent', content: string) => void | Promise<void>
  /** Moves a node (and every thread on it) onto another registered agent. */
  setNodeBackend: (nodeId: string, agentId: string) => void | Promise<void>
  /**
   * Records the learner's choices for a session's agent (model, effort, fast,
   * permission mode). Rejects with the backend's refusal — a mode that acts
   * without asking sent without `confirmedUnasked`, or a value not offered.
   */
  setNodeAgentSettings: (nodeId: string, patch: AgentSettingsPatch) => Promise<void>
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
  /** Rejects with the backend's reason when refused, e.g. while the node's project is archived. */
  restoreNode: (nodeId: string) => void | Promise<void>
  /** Resolves to the new project's id. An empty name is refused. */
  createProject: (name: string) => Promise<string>
  renameProject: (projectId: string, name: string) => Promise<void>
  /** An empty string clears the project's instructions. */
  setProjectInstructions: (projectId: string, instructions: string) => Promise<void>
  /** Archives the project with its sessions; refused for the default project. */
  archiveProject: (projectId: string) => Promise<void>
  /** Brings back the project and exactly the sessions it archived. */
  restoreProject: (projectId: string) => Promise<void>
  /** Moves its sessions to the default project and removes the project; deletes no session. */
  deleteProject: (projectId: string) => Promise<void>
  /** Changes only which project the session belongs to. */
  moveNodeToProject: (nodeId: string, projectId: string) => Promise<void>
  /** Read, not held: the archived list asks when it is shown and after what it does. */
  fetchArchivedProjects: () => Promise<ArchivedProject[]>
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
  const filter = validFilter(useWorkspaceStore.getState().projectFilter, snapshot.graph)
  if (filter !== useWorkspaceStore.getState().projectFilter) writeStoredProjectFilter(filter)
  set({
    projectFilter: filter,
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
  // A project the snapshot no longer carries (deleted, archived) must not
  // leave the history filtered to nothing.
  const filter = validFilter(state.projectFilter, snapshot.graph)
  if (filter !== state.projectFilter) writeStoredProjectFilter(filter)
  set({
    projectFilter: filter,
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

/**
 * Fixture mode only: a link to an archived node, as the backend reports it —
 * from each archived link whose other end is still on the graph.
 */
function fixtureArchivedLinks(graph: WorkspaceGraph): ArchivedLink[] {
  const present = new Set(graph.nodes.map((node) => node.id))
  const reported: ArchivedLink[] = []
  for (const [archivedNodeId, entry] of fixtureArchive) {
    for (const link of entry.links) {
      const other = link.parentId === archivedNodeId ? link.childId : link.parentId
      if (present.has(other)) {
        reported.push({ nodeId: other, archivedNodeId, archivedTitle: entry.node.title })
      }
    }
  }
  return reported
}

/** Fixture mode only: takes nodes off the graph, remembering whether a project took them. */
function fixtureTakeOff(
  state: Pick<WorkspaceState, 'graph' | 'openNodeId'>,
  nodeIds: string[],
  withProject: string | null,
): Partial<WorkspaceState> {
  const leaving = new Set(nodeIds)
  for (const node of state.graph.nodes.filter((candidate) => leaving.has(candidate.id))) {
    fixtureArchive.set(node.id, {
      node,
      links: state.graph.links.filter((link) => link.parentId === node.id || link.childId === node.id),
      withProject,
    })
  }
  // Links touching a node leave with it; its other end stays, unlinked.
  const graph = {
    ...state.graph,
    nodes: state.graph.nodes.filter((node) => !leaving.has(node.id)),
    links: state.graph.links.filter((link) => !leaving.has(link.parentId) && !leaving.has(link.childId)),
  }
  const closing = state.openNodeId !== null && leaving.has(state.openNodeId)
  return {
    graph: { ...graph, archivedLinks: fixtureArchivedLinks(graph) },
    ...(closing ? { openNodeId: null, openThreadId: null } : {}),
  }
}

/** Fixture mode only: puts archived nodes back, with the links whose other end is present. */
function fixtureBringBack(
  state: Pick<WorkspaceState, 'graph'>,
  nodeIds: string[],
): Partial<WorkspaceState> {
  const entries = nodeIds.flatMap((id) => {
    const entry = fixtureArchive.get(id)
    return entry ? [entry] : []
  })
  for (const id of nodeIds) fixtureArchive.delete(id)
  const nodes = [...state.graph.nodes, ...entries.map((entry) => entry.node)]
  const present = new Set(nodes.map((node) => node.id))
  const known = new Set(state.graph.links.map((link) => link.id))
  const links = [...state.graph.links]
  for (const entry of entries) {
    for (const link of entry.links) {
      // A link whose other end is archived stays off the graph, and a link
      // two restored nodes share is only added once.
      if (present.has(link.parentId) && present.has(link.childId) && !known.has(link.id)) {
        known.add(link.id)
        links.push(link)
      }
    }
  }
  const graph = { ...state.graph, nodes, links }
  return { graph: { ...graph, archivedLinks: fixtureArchivedLinks(graph) } }
}

function byDefaultThenCreated(a: Project, b: Project): number {
  return Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt)
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A project name cannot be empty')
  return trimmed
}

/** Renames a project or edits its instructions: one request, one fixture update. */
async function patchProject(
  get: () => WorkspaceState,
  set: (state: Partial<WorkspaceState>) => void,
  projectId: string,
  patch: { name?: string; instructions?: string },
): Promise<void> {
  const state = get()
  if (!state.workspaceId) throw new Error('Workspace is not hydrated')
  if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
    applyGraph(await updateProjectRequest(projectId, patch), get, set)
    return
  }
  if (!state.graph.projects.some((project) => project.id === projectId)) {
    throw new Error(`Cannot change unknown project: ${projectId}`)
  }
  set({
    graph: {
      ...state.graph,
      projects: state.graph.projects.map((project) =>
        project.id === projectId ? { ...project, ...patch } : project,
      ),
    },
  })
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...UNHYDRATED,
  // Device state, not account data: it survives `discardHydratedState`, and
  // the next snapshot decides whether it still names a project.
  projectFilter: readStoredProjectFilter(),

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

  setProjectFilter: (projectId) => {
    const next = validFilter(projectId, get().graph)
    set({ projectFilter: next })
    writeStoredProjectFilter(next)
  },

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
      const { projectId, ...nodeOverrides } = overrides ?? {}
      return branchNode(sourceNodeId, anchor, overrides ? nodeOverrides : undefined, projectId).then((snapshot) => {
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
      agentSettings: source.agentSettings ?? null,
      body: '',
      createdAt: now,
      lastOpenedAt: now,
      lastActivityAt: now,
      titleSource: 'topic',
      // The branch joins its source's project unless one is named; the link
      // back to the source crosses the two either way.
      projectId: overrides?.projectId ?? source.projectId,
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
      agentSettings: parent.agentSettings ?? null,
      body: '',
      createdAt: now,
      lastOpenedAt: now,
      lastActivityAt: now,
      titleSource: 'topic',
      projectId: parent.projectId,
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
          // Moving to another agent clears the choices made for the last one.
          node.id === nodeId
            ? { ...node, backendAgentId: agentId, agentSettings: null, agentState: null }
            : node,
        ),
      },
    })
  },

  setNodeAgentSettings: async (nodeId, patch) => {
    const state = get()
    if (!state.workspaceId) throw new Error('Workspace is not hydrated')
    if (!state.graph.nodes.some((node) => node.id === nodeId)) {
      throw new Error(`Cannot choose settings for unknown node: ${nodeId}`)
    }
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      const snapshot = await setNodeAgentSettingsRequest(nodeId, patch)
      applyGraph(snapshot, get, set)
      return
    }
    set({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) => {
          if (node.id !== nodeId) return node
          const settings: Record<string, string> = { ...(node.agentSettings ?? {}) }
          for (const key of ['model', 'effort', 'fast', 'mode'] as const) {
            if (!(key in patch)) continue
            const value = patch[key]
            if (value == null) delete settings[key]
            else settings[key] = value
          }
          return { ...node, agentSettings: settings }
        }),
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
    // A learner looking at one project who starts a session expects it there;
    // starting it in the default project would send it out of the history
    // they are looking at.
    const projectId = options.projectId ?? validFilter(state.projectFilter, state.graph) ?? undefined
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      const existing = new Set(state.graph.nodes.map((node) => node.id))
      return createRootNodeRequest({ title, mode: options.mode, projectId }).then(async (snapshot) => {
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
      projectId: projectId ?? state.graph.projects.find((project) => project.isDefault)?.id ?? null,
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
    set(fixtureTakeOff(state, [nodeId], null))
  },

  restoreNode: (nodeId) => {
    const state = get()
    if (!state.workspaceId) return Promise.reject(new Error('Workspace is not hydrated'))
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      return restoreNodeRequest(nodeId).then((snapshot) => applyGraph(snapshot, get, set))
    }
    const archived = fixtureArchive.get(nodeId)
    if (!archived) throw new Error(`Cannot restore a node that is not archived: ${nodeId}`)
    const owner = archived.node.projectId ? fixtureArchivedProjects.get(archived.node.projectId) : undefined
    if (owner) return Promise.reject(new Error(`Restore the project ${owner.project.name} first`))
    set(fixtureBringBack(state, [nodeId]))
  },

  createProject: async (name) => {
    const state = get()
    if (!state.workspaceId) throw new Error('Workspace is not hydrated')
    const trimmed = requireName(name)
    const existing = new Set(state.graph.projects.map((project) => project.id))
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      const snapshot = await createProjectRequest(trimmed)
      applyGraph(snapshot, get, set)
      const created = snapshot.graph.projects.find((project) => !existing.has(project.id))
      if (!created) throw new Error('Backend did not return the new project')
      return created.id
    }
    const project: Project = {
      id: nextId('p'),
      name: trimmed,
      instructions: '',
      isDefault: false,
      createdAt: new Date().toISOString(),
    }
    set({ graph: { ...state.graph, projects: [...state.graph.projects, project] } })
    return project.id
  },

  renameProject: async (projectId, name) => patchProject(get, set, projectId, { name: requireName(name) }),

  setProjectInstructions: (projectId, instructions) =>
    patchProject(get, set, projectId, { instructions }),

  archiveProject: async (projectId) => {
    const state = get()
    if (!state.workspaceId) throw new Error('Workspace is not hydrated')
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      applyGraph(await archiveProjectRequest(projectId), get, set)
      return
    }
    const project = state.graph.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new Error(`Cannot archive unknown project: ${projectId}`)
    if (project.isDefault) {
      throw new Error('The default project cannot be archived: it is where sessions without a project go.')
    }
    fixtureArchivedProjects.set(projectId, { project, archivedAt: new Date().toISOString() })
    const members = state.graph.nodes.filter((node) => node.projectId === projectId).map((node) => node.id)
    const taken = fixtureTakeOff(state, members, projectId)
    const graph = { ...(taken.graph ?? state.graph) }
    graph.projects = graph.projects.filter((candidate) => candidate.id !== projectId)
    set({ ...taken, graph })
    if (state.projectFilter === projectId) get().setProjectFilter(null)
  },

  restoreProject: async (projectId) => {
    const state = get()
    if (!state.workspaceId) throw new Error('Workspace is not hydrated')
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      applyGraph(await restoreProjectRequest(projectId), get, set)
      return
    }
    const archived = fixtureArchivedProjects.get(projectId)
    if (!archived) throw new Error(`Cannot restore a project that is not archived: ${projectId}`)
    fixtureArchivedProjects.delete(projectId)
    // Exactly the sessions this project archived: one archived on its own
    // beforehand carries no marker and stays archived.
    const marked = [...fixtureArchive].filter(([, entry]) => entry.withProject === projectId).map(([id]) => id)
    const brought = fixtureBringBack(state, marked)
    const graph = brought.graph ?? state.graph
    set({
      graph: { ...graph, projects: [...graph.projects, archived.project].sort(byDefaultThenCreated) },
    })
  },

  deleteProject: async (projectId) => {
    const state = get()
    if (!state.workspaceId) throw new Error('Workspace is not hydrated')
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      applyGraph(await deleteProjectRequest(projectId), get, set)
      return
    }
    const project = state.graph.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new Error(`Cannot delete unknown project: ${projectId}`)
    if (project.isDefault) {
      throw new Error('The default project cannot be deleted: it is where sessions without a project go.')
    }
    const fallback = state.graph.projects.find((candidate) => candidate.isDefault)?.id ?? null
    for (const entry of fixtureArchive.values()) {
      if (entry.node.projectId === projectId) {
        entry.node = { ...entry.node, projectId: fallback }
        entry.withProject = null
      }
    }
    set({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) =>
          node.projectId === projectId ? { ...node, projectId: fallback } : node,
        ),
        projects: state.graph.projects.filter((candidate) => candidate.id !== projectId),
      },
    })
    if (state.projectFilter === projectId) get().setProjectFilter(null)
  },

  moveNodeToProject: async (nodeId, projectId) => {
    const state = get()
    if (!state.workspaceId) throw new Error('Workspace is not hydrated')
    if (!state.graph.nodes.some((node) => node.id === nodeId)) {
      throw new Error(`Cannot move unknown node: ${nodeId}`)
    }
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) {
      applyGraph(await moveNodeToProjectRequest(nodeId, projectId), get, set)
      return
    }
    if (fixtureArchivedProjects.has(projectId)) throw new Error('An archived project cannot receive sessions.')
    if (!state.graph.projects.some((project) => project.id === projectId)) {
      throw new Error(`Cannot move a session to unknown project: ${projectId}`)
    }
    set({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) => (node.id === nodeId ? { ...node, projectId } : node)),
      },
    })
  },

  fetchArchivedProjects: async () => {
    const state = get()
    if (!state.workspaceId) throw new Error('Workspace is not hydrated')
    if (state.workspaceId !== FIXTURE_WORKSPACE_ID) return loadArchivedProjects()
    return [...fixtureArchivedProjects.values()].map(({ project, archivedAt }) => ({
      id: project.id,
      name: project.name,
      archivedAt,
      nodeCount: [...fixtureArchive.values()].filter((entry) => entry.node.projectId === project.id).length,
    }))
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
    fixtureArchivedProjects.clear()
    set({
      projectFilter: null,
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

/** The name of a project in the snapshot, or `null` for no project or one the snapshot does not carry. */
export function selectProjectName(state: Pick<WorkspaceState, 'graph'>, projectId: string | null): string | null {
  if (projectId === null) return null
  return state.graph.projects.find((project) => project.id === projectId)?.name ?? null
}
