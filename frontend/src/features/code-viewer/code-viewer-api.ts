import { z } from 'zod'

import apiClient, { ApiHttpError } from '../../shared/lib/api-client'

/** Why a file in the node's folder cannot be shown. */
export const NotViewableReasonSchema = z.enum(['too_large', 'not_text'])
export type NotViewableReason = z.infer<typeof NotViewableReasonSchema>

export const CodeFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  language: z.string().nullable(),
  viewable: z.boolean(),
  reason: NotViewableReasonSchema.nullable().catch(null),
})
export type CodeFile = z.infer<typeof CodeFileSchema>

const CodeFileListSchema = z.object({ files: z.array(CodeFileSchema) })

const CodeFileContentSchema = z.object({
  path: z.string(),
  language: z.string().nullable(),
  content: z.string(),
})

/** The code files in a node's working directory (never its practice mirror). */
export async function listCodeFiles(nodeId: string): Promise<CodeFile[]> {
  const { files } = await apiClient.get(`/workspace/nodes/${encodeURIComponent(nodeId)}/code`, {
    schema: CodeFileListSchema,
  })
  return files
}

export type FileRead =
  | { status: 'ready'; content: string }
  | { status: 'not_viewable'; reason: NotViewableReason }
  | { status: 'missing' }

/** One file's content, or why it cannot be read: too large, not text, or gone. */
export async function readCodeFile(nodeId: string, path: string): Promise<FileRead> {
  try {
    const file = await apiClient.get(
      `/workspace/nodes/${encodeURIComponent(nodeId)}/code/file?path=${encodeURIComponent(path)}`,
      { schema: CodeFileContentSchema },
    )
    return { status: 'ready', content: file.content }
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 404) return { status: 'missing' }
    if (error instanceof ApiHttpError && error.status === 422) {
      const detail = (error.body as { detail?: { reason?: unknown } } | undefined)?.detail
      const reason = NotViewableReasonSchema.safeParse(detail?.reason)
      return { status: 'not_viewable', reason: reason.success ? reason.data : 'not_text' }
    }
    throw error
  }
}
