import { PracticeRefusalError } from '../practice-api'
import { usePracticeStore } from '../practice-store'

/**
 * States every practice tool shares. Kept together so "loading" and
 * "unavailable" read the same in each tool — and so an unavailable tool
 * cannot accidentally render its working controls beside the explanation.
 */

export function ToolLoading({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="text-xs text-gray-500">
      {children}
    </p>
  )
}

/**
 * A tool that cannot work: says what is unavailable, and offers the one
 * control that does something — trying again.
 */
export function ToolUnavailable({
  what,
  reason,
  onRetry,
}: {
  what: string
  reason?: string
  onRetry: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-xs">
      <p className="font-medium text-red-700">{what}</p>
      {reason && <p className="break-words text-gray-500">{reason}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50"
      >
        Retry
      </button>
    </div>
  )
}

/** A refusal or failure from a form, shown in place beside the form. */
export function FormProblem({ message }: { message: string | null }) {
  if (message === null) return null
  return (
    <p role="alert" className="break-words text-xs text-red-700">
      {message}
    </p>
  )
}

export function attemptCountLabel(count: number): string {
  return count === 1 ? '1 attempt' : `${count} attempts`
}

export function describeFailure(error: unknown, fallback: string): string {
  // A refusal's message is the backend's reason, written for the learner.
  if (error instanceof PracticeRefusalError) return error.message
  const detail = error instanceof Error ? error.message : String(error)
  return `${fallback} (${detail})`
}

export const buttonPrimary =
  'rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300'
export const buttonSecondary =
  'rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50'
export const fieldClass =
  'w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none'

/**
 * Names the agent that wrote an item. The learner's own items carry no mark —
 * its absence is what says "yours".
 */
export function AuthorMark({ author }: { author: { name: string } | null }) {
  if (author === null) return null
  return (
    <span
      data-testid="item-author"
      className="self-start rounded bg-indigo-50 px-1 text-[10px] font-medium text-indigo-700"
    >
      by {author.name}
    </span>
  )
}

/** True while `itemId` is among the items just delivered to `nodeId`. */
export function useIsHighlighted(nodeId: string, itemId: string): boolean {
  return usePracticeStore(
    (s) => s.highlight !== null && s.highlight.nodeId === nodeId && s.highlight.itemIds.includes(itemId),
  )
}

/** Card classes, with the delivered-item highlight while it lasts. */
export function cardClass(highlighted: boolean): string {
  return `flex flex-col gap-2 rounded border p-2 text-xs transition-colors duration-700 ${
    highlighted ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300' : 'border-gray-200'
  }`
}
