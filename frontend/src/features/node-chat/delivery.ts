import { z } from 'zod'

import { practiceToolLabel, type DeliveredTool } from '../practice'

const NOUNS: Record<DeliveredTool, [string, string]> = {
  code: ['exercise', 'exercises'],
  qa: ['question', 'questions'],
  quiz: ['question', 'questions'],
}

/**
 * The line a delivery leaves in the conversation while its turn is live —
 * the same words the backend records (*"Codex sent 3 questions to Quiz"*),
 * which replace these once the turn's record is re-read.
 */
export function deliveryText({
  agentName,
  tool,
  itemIds,
}: {
  agentName: string
  tool: DeliveredTool
  itemIds: string[]
}): string {
  const [one, many] = NOUNS[tool]
  const count = itemIds.length
  return `${agentName || 'The agent'} sent ${count} ${count === 1 ? one : many} to ${practiceToolLabel(tool)}`
}

const DeliveryDataSchema = z.object({
  tool: z.enum(['code', 'qa', 'quiz']),
  itemIds: z.array(z.string()).default([]),
})

const NotDeliveredDataSchema = z.object({ tool: z.enum(['code', 'qa', 'quiz']) })

/** The `data` of a recorded `practice_delivered` message, or `null` if it is not usable. */
export function readDelivery(data: unknown): { tool: DeliveredTool; itemIds: string[] } | null {
  const parsed = DeliveryDataSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** The tool a `practice_not_delivered` notice names, or `null`. */
export function readNotDelivered(data: unknown): DeliveredTool | null {
  const parsed = NotDeliveredDataSchema.safeParse(data)
  return parsed.success ? parsed.data.tool : null
}
