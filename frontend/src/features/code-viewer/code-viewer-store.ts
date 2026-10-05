import { create } from 'zustand'

import { listCodeFiles, readCodeFile, type CodeFile, type FileRead } from './code-viewer-api'

export type CenterTab = 'conversation' | 'code'

export type FilesLoad =
  | { status: 'loading'; files: CodeFile[] }
  | { status: 'ready'; files: CodeFile[] }
  | { status: 'failed'; files: CodeFile[]; reason: string }

export type FileContent = { status: 'loading' } | { status: 'failed'; reason: string } | FileRead

export type CodeViewerState = {
  /** The center tab, for the node it was chosen on; any other node starts on the conversation. */
  tab: { nodeId: string; tab: CenterTab } | null
  /** The source shown in each node's Code tab, by its key (see `code-sources.ts`). */
  selected: Record<string, string>
  files: Record<string, FilesLoad>
  contents: Record<string, FileContent>
  showTab: (nodeId: string, tab: CenterTab) => void
  select: (nodeId: string, key: string) => void
  /** Switches the node to its Code tab with `key` shown — the conversation's "Open in Code". */
  openInCode: (nodeId: string, key: string) => void
  /** Re-reads the node's folder; earlier content of a file that changed is read again. Never rejects. */
  refreshFiles: (nodeId: string) => Promise<void>
  /** Reads a file unless it is already held. Never rejects. */
  loadFile: (nodeId: string, path: string) => Promise<void>
  discard: () => void
}

export const contentKey = (nodeId: string, path: string) => `${nodeId}\n${path}`

const INITIAL = { tab: null, selected: {}, files: {}, contents: {} }

export const useCodeViewerStore = create<CodeViewerState>((set, get) => ({
  ...INITIAL,
  showTab: (nodeId, tab) => set({ tab: { nodeId, tab } }),
  select: (nodeId, key) => set((s) => ({ selected: { ...s.selected, [nodeId]: key } })),
  openInCode: (nodeId, key) =>
    set((s) => ({ tab: { nodeId, tab: 'code' }, selected: { ...s.selected, [nodeId]: key } })),
  refreshFiles: async (nodeId) => {
    const previous = get().files[nodeId]?.files ?? []
    set((s) => ({ files: { ...s.files, [nodeId]: { status: 'loading', files: previous } } }))
    try {
      const files = await listCodeFiles(nodeId)
      set((s) => {
        // A file whose size changed since it was read is read again when shown.
        const contents = { ...s.contents }
        for (const file of files) {
          const before = previous.find((p) => p.path === file.path)
          if (!before || before.size !== file.size) delete contents[contentKey(nodeId, file.path)]
        }
        return { files: { ...s.files, [nodeId]: { status: 'ready', files } }, contents }
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      set((s) => ({ files: { ...s.files, [nodeId]: { status: 'failed', files: previous, reason } } }))
    }
  },
  loadFile: async (nodeId, path) => {
    const key = contentKey(nodeId, path)
    const held = get().contents[key]
    if (held && held.status !== 'failed') return
    set((s) => ({ contents: { ...s.contents, [key]: { status: 'loading' } } }))
    try {
      const read = await readCodeFile(nodeId, path)
      set((s) => ({ contents: { ...s.contents, [key]: read } }))
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      set((s) => ({ contents: { ...s.contents, [key]: { status: 'failed', reason } } }))
    }
  },
  discard: () => set(INITIAL),
}))
