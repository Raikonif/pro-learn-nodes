import { useEffect } from 'react'

import { contentKey, useCodeViewerStore } from '../code-viewer-store'
import { GROUP_LABELS, type CodeSource, type SourceGroup } from '../code-sources'
import CodeView from './CodeView'

const REASONS = {
  too_large: 'Too large to view (over 1 MB).',
  not_text: 'Not a text file.',
} as const

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SourceList({
  sources,
  selected,
  onSelect,
}: {
  sources: CodeSource[]
  selected: string | null
  onSelect: (key: string) => void
}) {
  const groups = (['files', 'exercises', 'conversation'] as SourceGroup[])
    .map((group) => ({ group, items: sources.filter((source) => source.group === group) }))
    .filter(({ items }) => items.length > 0)
  return (
    <nav aria-label="Code sources" className="max-h-40 shrink-0 overflow-y-auto border-b border-gray-200 pb-2">
      {groups.map(({ group, items }) => (
        <section key={group} aria-label={GROUP_LABELS[group]} className="mb-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{GROUP_LABELS[group]}</h3>
          <ul className="flex flex-col">
            {items.map((source) => {
              const unviewable = source.group === 'files' && !source.file.viewable
              return (
                <li key={source.key}>
                  <button
                    type="button"
                    aria-current={source.key === selected ? 'true' : undefined}
                    onClick={() => onSelect(source.key)}
                    className={`flex w-full items-baseline gap-2 truncate rounded px-1.5 py-0.5 text-left text-xs ${
                      source.key === selected ? 'bg-blue-50 font-medium text-blue-900' : 'text-gray-700 hover:bg-gray-100'
                    } ${unviewable ? 'text-gray-400' : ''}`}
                  >
                    <span className="truncate font-mono">{source.title}</span>
                    {source.group === 'files' ? (
                      <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                        {unviewable ? (source.file.reason === 'too_large' ? 'too large' : 'not text') : formatSize(source.file.size)}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}

function FileView({ nodeId, source }: { nodeId: string; source: Extract<CodeSource, { group: 'files' }> }) {
  const content = useCodeViewerStore((s) => s.contents[contentKey(nodeId, source.file.path)])
  const loadFile = useCodeViewerStore((s) => s.loadFile)
  const viewable = source.file.viewable

  useEffect(() => {
    if (viewable) void loadFile(nodeId, source.file.path)
  }, [nodeId, source.file.path, viewable, content, loadFile])

  if (!viewable) return <p role="status" className="text-xs text-gray-600">{REASONS[source.file.reason ?? 'not_text']}</p>
  if (!content || content.status === 'loading') return <p role="status" className="text-xs text-gray-500">Loading {source.file.path}…</p>
  if (content.status === 'failed') return <p role="status" className="text-xs text-red-700">{source.file.path} could not be read: {content.reason}</p>
  if (content.status === 'missing') return <p role="status" className="text-xs text-gray-600">{source.file.path} is no longer in the node's folder.</p>
  if (content.status === 'not_viewable') return <p role="status" className="text-xs text-gray-600">{REASONS[content.reason]}</p>
  return <CodeView code={content.content} language={source.language} label={source.file.path} />
}

function SourceView({ nodeId, source }: { nodeId: string; source: CodeSource }) {
  switch (source.group) {
    case 'files':
      return <FileView nodeId={nodeId} source={source} />
    case 'exercises':
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-1 whitespace-pre-wrap text-xs text-gray-700">{source.prompt}</p>
          <p className="mb-1 text-[11px] text-gray-500">Your current solution</p>
          <CodeView code={source.solution} language={source.language} label={`${source.title} — your solution`} />
        </div>
      )
    case 'conversation':
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-1 text-[11px] text-gray-500">From an agent message in this session</p>
          <CodeView code={source.code} language={source.language} label={source.title} />
        </div>
      )
  }
}

/** The Code tab: the node's code sources above, the chosen one below, read-only. */
function CodeTab({ nodeId, sources }: { nodeId: string; sources: CodeSource[] }) {
  const chosen = useCodeViewerStore((s) => s.selected[nodeId])
  const select = useCodeViewerStore((s) => s.select)
  const source =
    sources.find((candidate) => candidate.key === chosen) ??
    sources.find((candidate) => candidate.group !== 'files' || candidate.file.viewable) ??
    sources[0]

  return (
    <section aria-label="Code" data-testid="code-tab" className="flex h-full min-h-0 flex-col gap-2 p-4">
      <SourceList sources={sources} selected={source?.key ?? null} onSelect={(key) => select(nodeId, key)} />
      {source ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <SourceView nodeId={nodeId} source={source} />
        </div>
      ) : null}
    </section>
  )
}

export default CodeTab
