import { z } from 'zod'

import apiClient, { ApiHttpError } from './api-client'
import {
  WorkspaceGraphSchema,
  type NodeMode,
  type SelectionAnchor,
  type WorkspaceNode,
} from './workspace-types'

export const WorkspaceContextSchema = z.object({
  lastOpenNodeId: z.string().min(1).nullable(),
  viewport: z.record(z.string(), z.unknown()),
})

export const WorkspaceBootstrapSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  graph: WorkspaceGraphSchema,
  context: WorkspaceContextSchema,
})

export type WorkspaceBootstrap = z.infer<typeof WorkspaceBootstrapSchema>

const snapshot = { schema: WorkspaceBootstrapSchema }

/**
 * A refusal the learner should read as the backend wrote it ("Restore the
 * project Algebra first", "The default project cannot be archived"). The
 * status alone says that it was refused; the `detail` says why. Anything that
 * is not a refusal carrying a reason passes through unchanged.
 */
function withRefusalReason<T>(request: Promise<T>): Promise<T> {
  return request.catch((error: unknown) => {
    if (error instanceof ApiHttpError) {
      const detail = (error.body as { detail?: unknown } | undefined)?.detail
      if (typeof detail === 'string' && detail) throw new Error(detail)
    }
    throw error
  })
}

/**
 * No request here names a workspace.
 *
 * The backend derives the scope from the active account's session, so a
 * `workspaceId` in a body cannot widen what the request reaches — it can only
 * disagree with the session. It is ignored rather than rejected, which means a
 * client that kept sending one would keep working while quietly asserting an
 * authority it does not have. The response still carries `workspaceId`: the
 * client needs to know which workspace it is holding, it just never chooses.
 */
export function loadWorkspace(): Promise<WorkspaceBootstrap> {
  return apiClient.get('/workspace/bootstrap', snapshot)
}

/**
 * `projectId` names the project the branch is created in. Left out, the branch
 * joins its source's project; naming another is accepted and the link back to
 * the source simply crosses the two.
 */
export function branchNode(
  sourceNodeId: string,
  anchor: SelectionAnchor,
  overrides?: Partial<Pick<WorkspaceNode, 'title' | 'mode' | 'activeSkills' | 'mcpServers'>>,
  projectId?: string,
): Promise<WorkspaceBootstrap> {
  const body: Record<string, unknown> = { sourceNodeId, anchor, overrides }
  if (projectId) body.projectId = projectId
  return withRefusalReason(apiClient.post('/workspace/nodes/branch', body, snapshot))
}

/**
 * Starts a root session. Both fields are optional: without a title the node is
 * created with a provisional one that its first learner message replaces, and
 * without a mode it takes the default. Fields left out are left out of the
 * body rather than sent as `null`, so "not chosen" stays distinguishable.
 */
export function createRootNode(
  options: { title?: string; mode?: NodeMode; projectId?: string } = {},
): Promise<WorkspaceBootstrap> {
  const body: { title?: string; mode?: NodeMode; projectId?: string } = {}
  const title = options.title?.trim()
  if (title) body.title = title
  if (options.mode) body.mode = options.mode
  // Left out, the session lands in the workspace's default project.
  if (options.projectId) body.projectId = options.projectId
  return withRefusalReason(apiClient.post('/workspace/nodes', body, snapshot))
}

/** Sets a learner-chosen title, which automatic titling never replaces. */
export function renameNode(nodeId: string, title: string): Promise<WorkspaceBootstrap> {
  return apiClient.put(`/workspace/nodes/${encodeURIComponent(nodeId)}/title`, { title }, snapshot)
}

/**
 * Takes a session out of the history and the graph without deleting anything.
 * There is deliberately no delete helper: the history offers archive only.
 */
export function archiveNode(nodeId: string): Promise<WorkspaceBootstrap> {
  return apiClient.post(`/workspace/nodes/${encodeURIComponent(nodeId)}/archive`, {}, snapshot)
}

/**
 * Refused while the node's project is archived; the reason ("Restore the
 * project … first") is the rejection's message.
 */
export function restoreNode(nodeId: string): Promise<WorkspaceBootstrap> {
  return withRefusalReason(
    apiClient.post(`/workspace/nodes/${encodeURIComponent(nodeId)}/restore`, {}, snapshot),
  )
}

// ── Projects ─────────────────────────────────────────────────────────────
// Every route derives its workspace from the active account, like the rest of
// this file, and answers with the bootstrap snapshot the store replaces.

function projectPath(projectId: string): string {
  return `/workspace/projects/${encodeURIComponent(projectId)}`
}

export function createProject(name: string): Promise<WorkspaceBootstrap> {
  return withRefusalReason(apiClient.post('/workspace/projects', { name }, snapshot))
}

/** A key left out is unchanged: renaming does not touch instructions, nor the reverse. */
export function updateProject(
  projectId: string,
  patch: { name?: string; instructions?: string },
): Promise<WorkspaceBootstrap> {
  return withRefusalReason(apiClient.patch(projectPath(projectId), patch, snapshot))
}

/** Refused for the default project, with the reason. */
export function archiveProject(projectId: string): Promise<WorkspaceBootstrap> {
  return withRefusalReason(apiClient.post(`${projectPath(projectId)}/archive`, {}, snapshot))
}

export function restoreProject(projectId: string): Promise<WorkspaceBootstrap> {
  return withRefusalReason(apiClient.post(`${projectPath(projectId)}/restore`, {}, snapshot))
}

/** Moves its sessions to the default project; deletes no session. Refused for the default project. */
export function deleteProject(projectId: string): Promise<WorkspaceBootstrap> {
  return withRefusalReason(apiClient.delete(projectPath(projectId), snapshot))
}

/** Changes only membership. An archived project as the target is refused. */
export function moveNodeToProject(nodeId: string, projectId: string): Promise<WorkspaceBootstrap> {
  return withRefusalReason(
    apiClient.put(`/workspace/nodes/${encodeURIComponent(nodeId)}/project`, { projectId }, snapshot),
  )
}

/** An archived project as the archived list shows it: how much would come back. */
export const ArchivedProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  archivedAt: z.string().datetime({ offset: true }),
  nodeCount: z.number().int().nonnegative(),
})

export type ArchivedProject = z.infer<typeof ArchivedProjectSchema>

const ArchivedProjectsResponseSchema = z.object({ projects: z.array(ArchivedProjectSchema) })

export function loadArchivedProjects(): Promise<ArchivedProject[]> {
  return apiClient
    .get('/workspace/projects/archived', { schema: ArchivedProjectsResponseSchema })
    .then((response) => response.projects)
}

/**
 * One session a search matched. A title match carries no message
 * (`messageId: null`); a content match names the thread and message the
 * passage came from, so opening it can land on that message.
 */
export const SessionSearchResultSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string(),
  archived: z.boolean(),
  threadId: z.string().min(1).nullable().default(null),
  messageId: z.string().min(1).nullable().default(null),
  snippet: z.string().nullable().default(null),
  lastActivityAt: z.string().datetime({ offset: true }),
})

export type SessionSearchResult = z.infer<typeof SessionSearchResultSchema>

export const SessionSearchResponseSchema = z.object({
  results: z.array(SessionSearchResultSchema),
})

/** Searches session titles and message content, on the device. */
export function searchSessions(
  query: string,
  options: { includeArchived?: boolean } = {},
): Promise<SessionSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    includeArchived: String(options.includeArchived ?? false),
  })
  return apiClient
    .get(`/workspace/sessions/search?${params.toString()}`, { schema: SessionSearchResponseSchema })
    .then((response) => response.results)
}

export function createChildNode(parentNodeId: string): Promise<WorkspaceBootstrap> {
  return apiClient.post('/workspace/nodes/child', { parentNodeId }, snapshot)
}

export function createThread(
  nodeId: string,
  anchor: SelectionAnchor,
  name?: string,
): Promise<WorkspaceBootstrap> {
  return apiClient.post('/workspace/threads', { nodeId, anchor, name }, snapshot)
}

export function appendMessage(
  threadId: string,
  role: 'learner' | 'agent',
  content: string,
): Promise<WorkspaceBootstrap> {
  return apiClient.post('/workspace/messages', { threadId, role, content }, snapshot)
}

/**
 * Moves a node's conversation onto another registered agent. Every thread on
 * the node follows — a thread cannot run on a different backend from its node.
 */
export function setNodeBackend(nodeId: string, agentId: string): Promise<WorkspaceBootstrap> {
  return apiClient.put(`/workspace/nodes/${encodeURIComponent(nodeId)}/backend`, { agentId }, snapshot)
}

/**
 * What `PUT /workspace/nodes/{id}/agent-settings` takes. A key left out is
 * unchanged; a key set to `null` returns that control to the agent's default.
 * A mode that acts without asking is refused (422) unless `confirmedUnasked`.
 */
export type AgentSettingsPatch = {
  model?: string | null
  effort?: string | null
  fast?: string | null
  mode?: string | null
  confirmedUnasked?: boolean
}

/** Records the learner's choices for a session; its next turn applies them. */
export function setNodeAgentSettings(nodeId: string, patch: AgentSettingsPatch): Promise<WorkspaceBootstrap> {
  return apiClient.put(`/workspace/nodes/${encodeURIComponent(nodeId)}/agent-settings`, patch, snapshot)
}

export function saveWorkspaceContext(
  lastOpenNodeId: string | null,
  viewport: Record<string, unknown>,
): Promise<WorkspaceBootstrap> {
  return apiClient.put('/workspace/context', { lastOpenNodeId, viewport }, snapshot)
}
