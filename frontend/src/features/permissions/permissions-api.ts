import { z } from 'zod'

import apiClient, { ApiHttpError } from '../../shared/lib/api-client'

/**
 * Wire contract for the permission routes (acp-agent-permissions). Scoped to
 * the active account server-side: nothing here names a workspace.
 */
const nullableString = z.string().nullable().optional().transform((v) => v ?? null)

export const PendingPermissionSchema = z.object({
  requestId: z.string().min(1),
  nodeId: z.string().min(1),
  threadId: z.string().min(1),
  nodeTitle: z.string(),
  agentName: z.string(),
  title: z.string(),
  kind: nullableString,
  locations: z.array(z.string()).default([]),
  rememberable: z.boolean().default(false),
  agentRemembers: z.boolean().default(false),
})

export type PendingPermission = z.infer<typeof PendingPermissionSchema>

export const RememberedPermissionSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  nodeTitle: z.string(),
  agentId: z.string().min(1),
  agentName: z.string(),
  kind: z.string(),
  allow: z.boolean(),
  createdAt: z.string(),
})

export type RememberedPermission = z.infer<typeof RememberedPermissionSchema>

export function listPending(): Promise<PendingPermission[]> {
  return apiClient.get('/permissions/pending', { schema: z.array(PendingPermissionSchema) })
}

/**
 * Answers one request. Resolves `'decided'`, or `'gone'` when it was already
 * answered elsewhere (409) or no longer exists — its turn ended, or it was
 * never this account's (404). Either way the learner has nothing left to answer.
 */
export async function decide(
  requestId: string,
  allow: boolean,
  remember: boolean,
): Promise<'decided' | 'gone'> {
  try {
    await apiClient.post(
      `/permissions/pending/${encodeURIComponent(requestId)}`,
      { allow, remember },
      { schema: z.unknown() },
    )
    return 'decided'
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 404 || error.status === 409)) return 'gone'
    throw error
  }
}

export function listRemembered(): Promise<RememberedPermission[]> {
  return apiClient.get('/permissions/remembered', { schema: z.array(RememberedPermissionSchema) })
}

/** Revokes one remembered decision. One already gone is not an error. */
export async function revoke(id: string): Promise<void> {
  try {
    await apiClient.delete(`/permissions/remembered/${encodeURIComponent(id)}`, { schema: z.unknown() })
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 404) return
    throw error
  }
}

/** The kind of action a request is, as a phrase: "edits", "running commands". */
const KIND_PHRASES: Record<string, string> = {
  read: 'reading files',
  edit: 'edits',
  delete: 'deleting files',
  move: 'moving files',
  search: 'searches',
  execute: 'running commands',
  think: 'thinking',
  fetch: 'fetching from the web',
  switch_mode: 'switching modes',
}

export function kindPhrase(kind: string | null): string {
  if (!kind) return 'this action'
  return KIND_PHRASES[kind] ?? `"${kind}" actions`
}

/** "Always allow edits in this node" — how a remembered decision reads. */
export function rememberLabel(kind: string | null, allow = true): string {
  return `Always ${allow ? 'allow' : 'refuse'} ${kindPhrase(kind)} in this node`
}
