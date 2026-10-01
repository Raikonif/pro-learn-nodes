import { z } from 'zod'

import apiClient from '../../shared/lib/api-client'

/**
 * Wire contract for the memory routes (design.md "Interfaces" → Memory).
 * Every route is behind the account dependency; nothing here names an account.
 */
const nullableString = z.string().nullable().optional().transform((v) => v ?? null)

export const MemorySchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  /** A short stable key; a proposal on a known topic is a revision. */
  topic: nullableString,
  status: z.enum(['pending', 'accepted']),
  /** The agent that proposed it, by name. */
  proposedBy: z.string(),
  sourceNodeId: nullableString,
  sourceTitle: nullableString,
  createdAt: z.string(),
  decidedAt: nullableString,
  /** Set on a pending revision: the accepted memory it would replace. */
  revises: z
    .object({ id: z.string().min(1), text: z.string() })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** On an accepted memory: the texts it superseded, oldest first. */
  history: z.array(z.object({ text: z.string(), decidedAt: nullableString })).default([]),
})

export type Memory = z.infer<typeof MemorySchema>

export const MemoryListSchema = z.object({
  pending: z.array(MemorySchema),
  accepted: z.array(MemorySchema),
})

export type MemoryList = z.infer<typeof MemoryListSchema>

function memoryPath(id: string): string {
  return `/memory/${encodeURIComponent(id)}`
}

export function listMemory(): Promise<MemoryList> {
  return apiClient.get('/memory', { schema: MemoryListSchema })
}

/** Accepts a proposal; with `text`, accepts it as edited. */
export async function acceptMemory(id: string, text?: string): Promise<void> {
  await apiClient.post(`${memoryPath(id)}/accept`, text === undefined ? {} : { text }, { schema: z.unknown() })
}

export async function rejectMemory(id: string): Promise<void> {
  await apiClient.post(`${memoryPath(id)}/reject`, {}, { schema: z.unknown() })
}

/** Edits an accepted memory; its previous text joins its history. */
export async function editMemory(id: string, text: string): Promise<void> {
  await apiClient.put(memoryPath(id), { text }, { schema: z.unknown() })
}

/** Removes an accepted memory: no agent receives it afterwards. */
export async function removeMemory(id: string): Promise<void> {
  await apiClient.delete(memoryPath(id), { schema: z.unknown() })
}

/** Every accepted memory, as Markdown. */
export function exportMemory(): Promise<string> {
  return apiClient.getText('/memory/export')
}
