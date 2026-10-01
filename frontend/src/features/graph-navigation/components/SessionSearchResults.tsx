import type { SessionSearchResult } from '../../../shared/lib/workspace-api'

export type SessionSearchResultsProps = {
  results: SessionSearchResult[]
  onOpen: (result: SessionSearchResult) => void
  onRestore: (result: SessionSearchResult) => void
}

/**
 * What a search matched: sessions, each with the passage that matched when the
 * match was in a message rather than the title.
 *
 * An archived session is shown for what it is and offers Restore instead of
 * opening — there is no read-only view of an archived session; restoring it is
 * how it is opened.
 */
function SessionSearchResults({ results, onOpen, onRestore }: SessionSearchResultsProps) {
  return (
    <ul aria-label="Search results" className="flex flex-col gap-1">
      {results.map((result) => (
        <li
          key={`${result.nodeId}:${result.messageId ?? 'title'}`}
          data-testid="search-result"
          data-archived={result.archived ? 'true' : undefined}
          className="flex flex-col rounded-md hover:bg-gray-100"
        >
          {result.archived ? (
            <div className="flex min-w-0 flex-col px-2 pt-1">
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-sm text-gray-500">{result.title}</span>
                <span className="shrink-0 rounded bg-gray-200 px-1 text-[10px] font-medium uppercase text-gray-600">
                  Archived
                </span>
              </span>
              {result.snippet ? <Snippet text={result.snippet} /> : null}
            </div>
          ) : (
            <button
              type="button"
              aria-label={result.title}
              onClick={() => onOpen(result)}
              className="flex min-w-0 flex-col px-2 py-1 text-left"
            >
              <span className="truncate text-sm text-gray-800">{result.title}</span>
              {result.snippet ? <Snippet text={result.snippet} /> : null}
            </button>
          )}
          {result.archived ? (
            <div className="px-2 pb-1">
              <button
                type="button"
                aria-label={`Restore ${result.title}`}
                onClick={() => onRestore(result)}
                className="text-[11px] font-medium text-blue-700 hover:underline"
              >
                Restore
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** The matching passage. Rendered as text: nothing from an index is markup. */
function Snippet({ text }: { text: string }) {
  return (
    <span data-testid="search-snippet" className="line-clamp-2 text-xs text-gray-500">
      {text}
    </span>
  )
}

export default SessionSearchResults
