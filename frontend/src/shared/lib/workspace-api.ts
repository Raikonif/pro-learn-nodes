import { z } from 'zod'

import apiClient from './api-client'
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

export function branchNode(
  sourceNodeId: string,
  anchor: SelectionAnchor,
  overrides?: Partial<Pick<WorkspaceNode, 'title' | 'mode' | 'activeSkills' | 'mcpServers'>>,
): Promise<WorkspaceBootstrap> {
  return apiClient.post('/workspace/nodes/branch', { sourceNodeId, anchor, overrides }, snapshot)
}

/**
 * Starts a root session. Both fields are optional: without a title the node is
 * created with a provisional one that its first learner message replaces, and
 * without a mode it takes the default. Fields left out are left out of the
 * body rather than sent as `null`, so "not chosen" stays distinguishable.
 */
export function createRootNode(
  options: { title?: string; mode?: NodeMode } = {},
): Promise<WorkspaceBootstrap> {
  const body: { title?: string; mode?: NodeMode } = {}
  const title = options.title?.trim()
  if (title) body.title = title
  if (options.mode) body.mode = options.mode
  return apiClient.post('/workspace/nodes', body, snapshot)
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

export function restoreNode(nodeId: string): Promise<WorkspaceBootstrap> {
  return apiClient.post(`/workspace/nodes/${encodeURIComponent(nodeId)}/restore`, {}, snapshot)
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

export function saveWorkspaceContext(
  lastOpenNodeId: string | null,
  viewport: Record<string, unknown>,
): Promise<WorkspaceBootstrap> {
  return apiClient.put('/workspace/context', { lastOpenNodeId, viewport }, snapshot)
}
