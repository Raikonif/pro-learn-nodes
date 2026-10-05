import { useState } from 'react'

import { MessageText } from '../../code-viewer'
import { kindPhrase, PermissionRequestCard, usePermissionsStore } from '../../permissions'
import { practiceToolLabel, revealDelivery, type DeliveredTool } from '../../practice'
import { useAgentsStore } from '../../settings'
import type { PlanEntry } from '../chat-api'
import { deliveryText } from '../delivery'
import { useTurnStore, type LiveTurn } from '../turn-store'
import type { PermissionRequest } from '../chat-api'
import type { TurnOutcome } from '../../../shared/lib/workspace-types'

/**
 * How a turn that did not complete is labelled. A completed answer carries no
 * label at all — the absence is what makes the others stand out.
 */
const OUTCOME_LABELS: Record<Exclude<TurnOutcome, 'completed'>, string> = {
  incomplete: 'Incomplete — this turn did not finish',
  cancelled: 'Cancelled — stopped before it finished; what arrived is kept',
  refused: 'Refused — the agent declined this turn',
  failed: 'Failed — the turn did not complete',
}

export function OutcomeBadge({ outcome }: { outcome: TurnOutcome | null }) {
  if (outcome === null || outcome === 'completed') return null
  return (
    <span
      data-testid="turn-outcome"
      data-outcome={outcome}
      className="mt-1 inline-block self-start rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
    >
      {OUTCOME_LABELS[outcome]}
    </span>
  )
}

export function ToolEntry({ title, status }: { title: string; status?: string | null }) {
  return (
    <div
      data-testid="tool-activity"
      className="flex items-center gap-2 rounded border border-dashed border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-600"
    >
      <span className="font-semibold uppercase tracking-wide text-gray-400">Tool</span>
      <span className="font-mono">{title}</span>
      {status ? <span className="ml-auto text-gray-400">{status}</span> : null}
    </div>
  )
}

export function PermissionRefusedNotice({ title }: { title: string }) {
  return (
    <div
      role="note"
      data-testid="permission-refused"
      className="rounded border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-900"
    >
      <p>
        The agent asked to: <span className="font-medium">{title}</span>. The request was refused.
      </p>
      <p className="text-orange-800">It arrived when nothing could ask you, so it was refused without asking.</p>
    </div>
  )
}

/** What the learner answered when the agent asked — part of the record. */
export function PermissionDecisionNotice({
  title,
  kind,
  allow,
  remembered,
}: {
  title: string
  kind: string | null
  allow: boolean
  remembered: boolean
}) {
  return (
    <div
      role="note"
      data-testid="permission-decision"
      data-allow={allow ? 'true' : 'false'}
      className={`rounded border px-2 py-1 text-xs ${
        allow ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-orange-200 bg-orange-50 text-orange-900'
      }`}
    >
      <span className="font-semibold">{allow ? 'Allowed' : 'Refused'}:</span>{' '}
      <span className="font-medium">{title || kindPhrase(kind)}</span>
      {remembered ? <span className="ml-1">— remembered for this node</span> : null}
    </div>
  )
}

/** Reads a recorded `permission_decision` message's answer and detail. */
export function readDecision(outcome: string | null, data: Record<string, unknown> | null | undefined) {
  const allow = typeof data?.allow === 'boolean' ? data.allow : outcome !== 'refused'
  return {
    allow,
    kind: typeof data?.kind === 'string' ? data.kind : null,
    remembered: data?.remembered === true,
  }
}

/**
 * A request the agent is waiting on, answered here. On an answer it stays
 * until the turn reports it decided (which records it); if it was already
 * answered elsewhere, or is gone, it simply leaves.
 */
export function PermissionPrompt({ threadId, request }: { threadId: string; request: PermissionRequest }) {
  const decide = usePermissionsStore((s) => s.decide)
  const busy = usePermissionsStore((s) => Boolean(s.answering[request.requestId]))
  const dismiss = useTurnStore((s) => s.dismissPermission)
  const [error, setError] = useState<string | null>(null)

  async function answer(allow: boolean, remember: boolean) {
    setError(null)
    try {
      const result = await decide(request.requestId, allow, remember)
      if (result === 'gone') dismiss(threadId, request.requestId)
    } catch {
      setError('The answer could not be sent. Try again.')
    }
  }

  return (
    <PermissionRequestCard
      request={request}
      busy={busy}
      error={error}
      onAnswer={(allow, remember) => void answer(allow, remember)}
    />
  )
}

export function ContinuitySeamNotice({ reason }: { reason: string }) {
  return (
    <div
      role="note"
      data-testid="continuity-seam"
      className="border-y border-dotted border-gray-300 py-1 text-center text-xs text-gray-500"
    >
      The agent could not resume its earlier session, so the conversation was re-established from
      this record{reason ? ` (${reason})` : ''}.
    </div>
  )
}

/** A session choice the agent no longer offers, which was therefore not sent. */
export function SettingsNotice({ text }: { text: string }) {
  return (
    <div
      role="note"
      data-testid="settings-notice"
      className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
    >
      {text || 'A session choice is no longer offered by the agent, so its default was used.'}
    </div>
  )
}

/**
 * What a completed agent turn with no text says instead of an empty bubble.
 * Legitimate, not a failure: an agent command such as `/compact` can finish
 * without a reply.
 */
export function emptyReplyText(learnerText: string | null | undefined): string {
  const command = /^\/(\S+)/.exec(learnerText?.trim() ?? '')?.[1]
  return command ? `Ran /${command}` : 'The agent finished without a reply'
}

export function EmptyReply({ learnerText }: { learnerText: string | null | undefined }) {
  return (
    <p data-testid="empty-agent-reply" className="text-xs italic text-gray-500">
      {emptyReplyText(learnerText)}
    </p>
  )
}

/**
 * A delivery recorded in the conversation: who sent what to which tool, and a
 * way back to it — after a restart this is the only one, so it carries the
 * item ids itself rather than relying on the stream having been seen.
 */
export function PracticeDeliveredEntry({
  nodeId,
  text,
  delivery,
}: {
  nodeId: string
  text: string
  delivery: { tool: DeliveredTool; messageId: string; itemIds: string[] } | null
}) {
  return (
    <div
      role="note"
      data-testid="practice-delivered"
      className="flex flex-wrap items-center gap-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-900"
    >
      <span>{text}</span>
      {delivery ? (
        <button
          type="button"
          onClick={() => revealDelivery({ nodeId, ...delivery })}
          className="ml-auto font-medium text-indigo-700 underline hover:text-indigo-900"
        >
          Open in {practiceToolLabel(delivery.tool)} →
        </button>
      ) : null}
    </div>
  )
}

/** A `/code`, `/qa` or `/quiz` turn that delivered nothing, said plainly. */
export function PracticeNotDeliveredNotice({ text, tool }: { text: string; tool: DeliveredTool | null }) {
  return (
    <div
      role="note"
      data-testid="practice-not-delivered"
      className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
    >
      {text || `Nothing was delivered to ${tool ? practiceToolLabel(tool) : 'the practice rail'}.`}
    </div>
  )
}

export function PlanView({ entries }: { entries: PlanEntry[] }) {
  return (
    <div data-testid="agent-plan" className="rounded border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-900">
      <p className="font-semibold">Plan</p>
      <ol className="list-decimal pl-5">
        {entries.map((entry, index) => (
          <li key={index} data-status={entry.status}>
            {entry.content}
            <span className="ml-1 text-blue-700">({entry.status})</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

const ROLE_CLASS = 'mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'

/**
 * The part of a turn still arriving: rendered as it streams, before the
 * backend's record of it is re-read.
 */
export function LiveTurnEntries({ turn, nodeId }: { turn: LiveTurn; nodeId: string }) {
  const running = turn.phase === 'running'
  const learner = turn.entries.find((entry) => entry.type === 'learner')
  const learnerText = learner?.type === 'learner' ? learner.text : null
  return (
    <>
      {turn.entries.map((entry) => {
        switch (entry.type) {
          case 'learner':
            return (
              <li key={entry.key} className="flex flex-col">
                <span className={ROLE_CLASS}>You</span>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{entry.text}</p>
              </li>
            )
          case 'agent':
            if (!running && turn.outcome === 'completed' && !entry.text.trim()) {
              return (
                <li key={entry.key} className="flex flex-col" data-testid="live-agent-message">
                  <span className={ROLE_CLASS}>Agent</span>
                  <EmptyReply learnerText={learnerText} />
                </li>
              )
            }
            return (
              <li key={entry.key} className="flex flex-col" data-testid="live-agent-message" aria-busy={running}>
                <span className={ROLE_CLASS}>Agent</span>
                {entry.thought ? (
                  <details className="mb-1 text-xs text-gray-500">
                    <summary>Reasoning</summary>
                    <p className="whitespace-pre-wrap italic">{entry.thought}</p>
                  </details>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                  <MessageText text={entry.text} />
                  {running ? <span className="ml-1 animate-pulse text-gray-400">▍</span> : null}
                </p>
                {running ? null : <OutcomeBadge outcome={turn.outcome} />}
              </li>
            )
          case 'tool':
            return (
              <li key={entry.key}>
                <ToolEntry title={entry.title} status={entry.status} />
              </li>
            )
          case 'plan':
            return (
              <li key={entry.key}>
                <PlanView entries={entry.entries} />
              </li>
            )
          case 'permission_refused':
            return (
              <li key={entry.key}>
                <PermissionRefusedNotice title={entry.title} />
              </li>
            )
          case 'permission_decision':
            return (
              <li key={entry.key}>
                <PermissionDecisionNotice
                  title={entry.title}
                  kind={entry.kind}
                  allow={entry.allow}
                  remembered={entry.remembered}
                />
              </li>
            )
          case 'continuity_seam':
            return (
              <li key={entry.key}>
                <ContinuitySeamNotice reason={entry.reason} />
              </li>
            )
          case 'settings_notice':
            return (
              <li key={entry.key}>
                <SettingsNotice text={entry.text} />
              </li>
            )
          case 'practice_delivered':
            return (
              <li key={entry.key}>
                <PracticeDeliveredEntry
                  nodeId={nodeId}
                  text={deliveryText(entry)}
                  delivery={{ tool: entry.tool, messageId: entry.id, itemIds: entry.itemIds }}
                />
              </li>
            )
        }
      })}
      {turn.phase === 'running'
        ? turn.permissions.map((request) => (
            <li key={`permission-${request.requestId}`}>
              <PermissionPrompt threadId={turn.threadId} request={request} />
            </li>
          ))
        : null}
    </>
  )
}

const FAILURE_TEXT: Record<string, string> = {
  no_agent: 'No agent is registered, so your message was recorded but not answered. Register an agent to continue.',
  not_authenticated:
    'The agent is not logged in. Log in through the agent itself, then send again — Learn Nodes never handles its credentials.',
  unreachable: 'The agent could not be reached — it may not be installed on this device.',
  request_failed: 'The message could not be sent.',
}

/**
 * Why the last turn in this thread did not complete, and what to do about it.
 * Stays until the next message is sent: the reason is not part of the record.
 */
export function TurnNotice({ turn }: { turn: LiveTurn }) {
  const openPanel = useAgentsStore((s) => s.openPanel)
  if (turn.phase !== 'ended') return null

  if (turn.outcome === 'failed') {
    const text = (turn.reason && FAILURE_TEXT[turn.reason]) || 'The turn failed.'
    const needsSettings = turn.reason === 'no_agent' || turn.reason === 'not_authenticated' || turn.reason === 'unreachable'
    return (
      <div role="alert" data-testid="turn-failure" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900">
        <p>{text}</p>
        {turn.detail ? <p className="mt-0.5 font-mono text-[11px]">{turn.detail}</p> : null}
        {needsSettings ? (
          <button
            type="button"
            onClick={openPanel}
            className="mt-1 font-medium text-red-900 underline hover:text-red-700"
          >
            Open agent settings
          </button>
        ) : null}
      </div>
    )
  }

  if (turn.outcome === 'incomplete' && turn.reason === 'connection_lost') {
    return (
      <p role="alert" className="text-xs text-amber-900">
        The connection to this turn was lost. What arrived was kept and is marked incomplete.
      </p>
    )
  }

  if (turn.outcome === 'completed' && turn.usage?.totalTokens != null) {
    return (
      <p data-testid="turn-usage" className="text-right text-[11px] text-gray-400">
        {turn.usage.totalTokens} tokens{turn.usage.model ? ` · ${turn.usage.model}` : ''}
      </p>
    )
  }

  return null
}
