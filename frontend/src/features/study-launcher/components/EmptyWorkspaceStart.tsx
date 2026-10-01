import DetailedStart from './DetailedStart'
import QuickStartButton from './QuickStartButton'

/**
 * What the center region shows an account with no sessions: both ways to
 * begin, in place of a graph that would have nothing on it.
 */
function EmptyWorkspaceStart() {
  return (
    <section
      aria-label="Start a session"
      data-testid="empty-workspace-start"
      className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-base font-semibold text-gray-900">Start your first session</h2>
        <p className="text-sm text-gray-600">
          Write straight away, or pick a topic and a learning mode first.
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-2">
        <QuickStartButton variant="prominent" />
        <DetailedStart variant="prominent" />
      </div>
    </section>
  )
}

export default EmptyWorkspaceStart
