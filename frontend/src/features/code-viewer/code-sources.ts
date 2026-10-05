import { useMemo } from 'react'

import { messagesForThread } from '../../shared/lib/fixtures'
import { useWorkspaceStore } from '../../shared/lib/workspace-store'
import type { WorkspaceGraph } from '../../shared/lib/workspace-types'

import type { CodeFile } from './code-viewer-api'
import { useCodeViewerStore } from './code-viewer-store'
import { codeBlocks } from './fences'
import { languageOf, languageOfPath, LANGUAGE_LABELS, type LanguageId } from './languages'

export type SourceGroup = 'files' | 'exercises' | 'conversation'

export const GROUP_LABELS: Record<SourceGroup, string> = {
  files: "Files in this node's folder",
  exercises: 'Practice exercises',
  conversation: 'From the conversation',
}

/** One piece of code the node has, wherever it lives. `key` is stable across renders. */
export type CodeSource =
  | ({ key: string; group: 'files'; title: string; language: LanguageId | null } & { file: CodeFile })
  | {
      key: string
      group: 'exercises'
      title: string
      language: LanguageId
      itemId: string
      prompt: string
      solution: string
    }
  | { key: string; group: 'conversation'; title: string; language: LanguageId | null; messageId: string; index: number; code: string }

export const fileKey = (path: string) => `file:${path}`
export const exerciseKey = (itemId: string) => `exercise:${itemId}`
export const blockKey = (messageId: string, index: number) => `block:${messageId}:${index}`

function firstLine(text: string, fallback: string): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? ''
  if (!line) return fallback
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

/** Code blocks in the agent messages of every thread of the node, oldest first. */
export function conversationBlocks(graph: WorkspaceGraph, nodeId: string): CodeSource[] {
  const sources: CodeSource[] = []
  for (const thread of graph.threads.filter((t) => t.nodeId === nodeId)) {
    for (const message of messagesForThread(graph, thread.id)) {
      if (message.role !== 'agent' || message.kind !== 'message') continue
      for (const block of codeBlocks(message.content)) {
        if (!block.code.trim()) continue
        const language = block.language ?? languageOf(block.info)
        const kind = language ? LANGUAGE_LABELS[language] : block.info || 'Code'
        sources.push({
          key: blockKey(message.id, block.index),
          group: 'conversation',
          title: `${kind} block — ${firstLine(block.code, 'empty')}`,
          language,
          messageId: message.id,
          index: block.index,
          code: block.code,
        })
      }
    }
  }
  return sources
}

/** A code exercise as practice hands it over: statement and the learner's current solution. */
export type ExerciseCode = { id: string; prompt: string; solution: string }

/**
 * Every code source of the node, grouped files → exercises → conversation.
 * Empty means the node has no code, and the Code tab is not offered.
 * `exercises` come from practice, through the caller, so this feature does
 * not depend on practice (practice shows code with this feature's viewer).
 */
export function useCodeSources(nodeId: string | null, exercises: ExerciseCode[]): CodeSource[] {
  const files = useCodeViewerStore((s) => (nodeId ? s.files[nodeId]?.files : undefined))
  const graph = useWorkspaceStore((s) => s.graph)

  return useMemo(() => {
    if (!nodeId) return []
    const fromFiles: CodeSource[] = (files ?? []).map((file) => ({
      key: fileKey(file.path),
      group: 'files',
      title: file.path,
      language: languageOf(file.language) ?? languageOfPath(file.path),
      file,
    }))
    const fromExercises: CodeSource[] = exercises.map((exercise) => ({
      key: exerciseKey(exercise.id),
      group: 'exercises',
      title: firstLine(exercise.prompt, 'Code exercise'),
      language: 'python',
      itemId: exercise.id,
      prompt: exercise.prompt,
      solution: exercise.solution,
    }))
    return [...fromFiles, ...fromExercises, ...conversationBlocks(graph, nodeId)]
  }, [nodeId, files, exercises, graph])
}
