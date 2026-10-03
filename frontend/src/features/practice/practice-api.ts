import { z } from 'zod'

import apiClient, { ApiHttpError } from '../../shared/lib/api-client'

/**
 * Wire contract for the practice routes (design.md "The wire shapes").
 *
 * The workspace scope is never sent: the backend resolves it from the active
 * account, so every path names only the node or item within that scope.
 */
export const PracticeOptionSchema = z.object({
  text: z.string(),
  correct: z.boolean(),
})

export type PracticeOption = z.infer<typeof PracticeOptionSchema>

export const PracticeItemKindSchema = z.enum(['free_response', 'multiple_choice', 'code_exercise'])
export type PracticeItemKind = z.infer<typeof PracticeItemKindSchema>

/**
 * Who wrote an item: `null` for the learner, otherwise the agent — `name` is
 * a snapshot, so an item still names its author after the agent is removed.
 */
export const PracticeAuthorSchema = z.object({
  agentId: z.string().nullable(),
  name: z.string().min(1),
})

export type PracticeAuthor = z.infer<typeof PracticeAuthorSchema>

/** `null` when absent: a payload from before a field existed still parses. */
const nullableString = z.string().nullable().optional().transform((v) => v ?? null)

export const PracticeItemSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  kind: PracticeItemKindSchema,
  prompt: z.string(),
  options: z.array(PracticeOptionSchema).default([]),
  referenceAnswer: nullableString,
  createdAt: z.string(),
  /** Code exercises only: what the exercise's buffer starts from. */
  starterCode: nullableString,
  /** Code exercises only: what a correct program prints, when the author said. */
  expectedOutput: nullableString,
  authoredBy: PracticeAuthorSchema.nullable().optional().transform((v) => v ?? null),
  /**
   * The delivery that brought an agent's item; `null` for the learner's own
   * and for a backend that predates the field. Items sharing one are a block.
   */
  deliveryId: nullableString,
})

export type PracticeItem = z.infer<typeof PracticeItemSchema>

export const RunOutcomeKindSchema = z.enum(['completed', 'error', 'stopped', 'timed_out'])
export type RunOutcomeKind = z.infer<typeof RunOutcomeKindSchema>

export const PracticeAttemptSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  nodeId: z.string().min(1),
  response: z.string().nullable(),
  chosenOption: z.number().int().nullable(),
  correct: z.boolean().nullable(),
  score: z.number().nullable(),
  createdAt: z.string(),
  /** Code exercises only: how the submitted run ended. */
  runOutcome: RunOutcomeKindSchema.nullable().optional().transform((v) => v ?? null),
  /** Code exercises only: what the submitted run printed. */
  runOutput: nullableString,
})

export type PracticeAttempt = z.infer<typeof PracticeAttemptSchema>

export const SandboxBufferSchema = z.object({
  code: z.string(),
  updatedAt: z.string().nullable(),
})

export type SandboxBuffer = z.infer<typeof SandboxBufferSchema>

export const NodePracticeSchema = z.object({
  nodeId: z.string().min(1),
  /** Oldest first. */
  items: z.array(PracticeItemSchema),
  /** Newest first. */
  attempts: z.array(PracticeAttemptSchema),
  sandbox: SandboxBufferSchema,
})

export type NodePractice = z.infer<typeof NodePracticeSchema>

/**
 * The outcome of reading a node's practice material.
 *
 * A failure is its own state rather than a thrown error the caller might
 * swallow into `[]`: "this node has no questions" and "this node's questions
 * could not be loaded" must never render the same.
 */
export type PracticeLoad =
  | { status: 'loaded'; material: NodePractice }
  | { status: 'failed'; reason: string }

export type ItemDraft =
  | { kind: 'free_response'; prompt: string; referenceAnswer?: string }
  | { kind: 'multiple_choice'; prompt: string; options: PracticeOption[] }
  | { kind: 'code_exercise'; prompt: string; starterCode?: string; expectedOutput?: string }

/** A code exercise's submission: the buffer as submitted and the run it produced. */
export type CodeSubmission = { code: string; runOutcome: RunOutcomeKind; runOutput: string }

export type AttemptDraft = { response: string } | { chosenOption: number } | CodeSubmission

/**
 * The backend refused an item or an attempt (422) and said why. The message is
 * the backend's reason, written for the learner, and is shown in place.
 */
export class PracticeRefusalError extends Error {
  override readonly name = 'PracticeRefusalError'
}

const RefusalSchema = z.object({ detail: z.string().min(1) })

function nodePath(nodeId: string): string {
  return `/practice/nodes/${encodeURIComponent(nodeId)}`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function loadNodePractice(nodeId: string): Promise<PracticeLoad> {
  try {
    const material = await apiClient.get(nodePath(nodeId), { schema: NodePracticeSchema })
    return { status: 'loaded', material }
  } catch (error) {
    return { status: 'failed', reason: describe(error) }
  }
}

/** Rethrows a 422 carrying a reason as a `PracticeRefusalError`; anything else unchanged. */
function asRefusal(error: unknown): unknown {
  if (error instanceof ApiHttpError && error.status === 422) {
    const refusal = RefusalSchema.safeParse(error.body)
    if (refusal.success) return new PracticeRefusalError(refusal.data.detail)
  }
  return error
}

export async function authorItem(nodeId: string, draft: ItemDraft): Promise<PracticeItem> {
  try {
    return await apiClient.post(`${nodePath(nodeId)}/items`, draft, { schema: PracticeItemSchema })
  } catch (error) {
    throw asRefusal(error)
  }
}

export async function submitAttempt(itemId: string, answer: AttemptDraft): Promise<PracticeAttempt> {
  try {
    return await apiClient.post(`/practice/items/${encodeURIComponent(itemId)}/attempts`, answer, {
      schema: PracticeAttemptSchema,
    })
  } catch (error) {
    throw asRefusal(error)
  }
}

function sandboxPath(nodeId: string, itemId?: string): string {
  const base = `${nodePath(nodeId)}/sandbox`
  return itemId === undefined ? base : `${base}?itemId=${encodeURIComponent(itemId)}`
}

/**
 * Reads a code exercise's own buffer. One never saved reads as the exercise's
 * starter code with `updatedAt: null`. (The node's free buffer arrives with
 * `loadNodePractice` and needs no read of its own.)
 */
export function loadExerciseBuffer(nodeId: string, itemId: string): Promise<SandboxBuffer> {
  return apiClient.get(sandboxPath(nodeId, itemId), { schema: SandboxBufferSchema })
}

/**
 * Replaces a buffer — the node's free one, or with `itemId` that exercise's.
 * Carries code only — a run's output is never sent.
 */
export function saveSandbox(nodeId: string, code: string, itemId?: string): Promise<SandboxBuffer> {
  return apiClient.put(sandboxPath(nodeId, itemId), { code }, { schema: SandboxBufferSchema })
}
