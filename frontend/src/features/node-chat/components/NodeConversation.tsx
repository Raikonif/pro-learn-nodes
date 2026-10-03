import { useEffect, useState } from 'react'

import {
  messagesForThread,
  nodeById,
  threadsAnchoredTo,
} from '../../../shared/lib/fixtures'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { SessionProject } from '../../projects'
import { isMainThread, type ChatMessage } from '../../../shared/lib/workspace-types'
import { readDelivery, readNotDelivered } from '../delivery'
import { useSessionAgent } from '../hooks/use-session-agent'
import { MESSAGE_CONTENT_ATTR } from '../hooks/use-text-selection'
import { liveMessageIds, useTurnStore } from '../turn-store'

import Composer from './Composer'
import NodeBackend from './NodeBackend'
import SelectionAffordance from './SelectionAffordance'
import SessionControls from './SessionControls'
import BranchOrigin from './BranchOrigin'
import ThreadBackLink from './ThreadBackLink'
import ThreadStub from './ThreadStub'
import {
  ContinuitySeamNotice,
  EmptyReply,
  LiveTurnEntries,
  OutcomeBadge,
  PermissionRefusedNotice,
  PracticeDeliveredEntry,
  PracticeNotDeliveredNotice,
  SettingsNotice,
  ToolEntry,
  TurnNotice,
} from './TurnEntries'

const ROLE_LABELS = { learner: 'You', agent: 'Agent' } as const

/** How long a message opened from search stays highlighted. */
export const REVEAL_HIGHLIGHT_MS = 2000

/**
 * Brings the message a search result pointed at into view and highlights it
 * briefly. The request lives in the workspace store (`revealedMessageId`)
 * because the rail that sets it and the conversation that honours it share
 * nothing else; it is cleared once the highlight has run, so re-rendering the
 * thread later does not scroll the learner back.
 */
function useRevealedMessage(threadMessageIds: string[]): string | null {
  const revealedMessageId = useWorkspaceStore((s) => s.revealedMessageId)
  const clearRevealedMessage = useWorkspaceStore((s) => s.clearRevealedMessage)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const present = revealedMessageId !== null && threadMessageIds.includes(revealedMessageId)

  useEffect(() => {
    if (!revealedMessageId || !present) return
    const element = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (candidate) => candidate.dataset.messageId === revealedMessageId,
    )
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlighted(revealedMessageId)
    clearRevealedMessage()
  }, [revealedMessageId, present, clearRevealedMessage])

  useEffect(() => {
    if (!highlighted) return
    const timer = setTimeout(() => setHighlighted(null), REVEAL_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlighted])

  return highlighted
}

/**
 * The center region: the open node's currently open thread.
 *
 * Reads the store rather than taking props because every other surface
 * (canvas, minimap, left rail, thread list) can change what is open, and
 * threading that through the app shell would make each of them responsible
 * for the chat's state.
 *
 * The node header shows mode and configuration as static text: threads
 * inherit the node's mode, skills, and MCP servers and cannot override them,
 * so a control here would be offering something the model does not allow.
 * The one node-level control is the conversation backend (`NodeBackend`),
 * which changes the node — and so every thread on it — never one thread.
 *
 * A turn in progress renders from the turn store; recorded messages from the
 * graph. A message the live turn is still showing is left out of the recorded
 * list, so a snapshot re-read mid-turn can never show it twice.
 */
function NodeConversation() {
  const graph = useWorkspaceStore((s) => s.graph)
  const openNodeId = useWorkspaceStore((s) => s.openNodeId)
  const openThreadId = useWorkspaceStore((s) => s.openThreadId)
  const liveTurn = useTurnStore((s) => (openThreadId ? s.turns[openThreadId] : undefined))

  const node = openNodeId ? nodeById(graph, openNodeId) : undefined
  const thread = graph.threads.find((t) => t.id === openThreadId)
  const recorded = thread ? messagesForThread(graph, thread.id) : []
  const highlighted = useRevealedMessage(recorded.map((message) => message.id))
  const session = useSessionAgent(node, openThreadId)

  if (!node || !thread) {
    return (
      <section aria-label="Conversation" className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">Open a node to start a conversation.</p>
      </section>
    )
  }

  const live = liveMessageIds(liveTurn)
  const messages = recorded.filter((message) => !live.has(message.id))
  const spawned = !isMainThread(thread)

  return (
    <section aria-label="Conversation" className="flex h-full flex-col overflow-y-auto p-4">
      <header className="mb-4 border-b border-gray-200 pb-3">
        <h2 className="text-lg font-semibold text-gray-900">{node.title}</h2>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
            {node.mode}
          </span>
          <SessionProject projectId={node.projectId} />
          <span>{spawned ? thread.name : 'main'}</span>
        </p>
        <NodeBackend node={node} />
        <SessionControls node={node} agent={session} />
      </header>

      {spawned ? <ThreadBackLink thread={thread} /> : <BranchOrigin nodeId={node.id} />}

      <ul className="flex flex-col gap-4">
        {messages.map((message, index) => (
          <RecordedMessage
            key={message.id}
            message={message}
            nodeId={node.id}
            highlighted={message.id === highlighted}
            learnerText={precedingLearnerText(messages, index)}
          />
        ))}
        {liveTurn ? <LiveTurnEntries turn={liveTurn} nodeId={node.id} /> : null}
      </ul>

      {liveTurn ? (
        <div className="mt-3">
          <TurnNotice turn={liveTurn} />
        </div>
      ) : null}

      <Composer
        threadId={thread.id}
        agent={session?.offer?.offer?.known ? { name: session.name, commands: session.offer.offer.commands } : null}
      />

      <SelectionAffordance />
    </section>
  )
}

/** The learner message an agent message answered: the nearest one before it. */
function precedingLearnerText(messages: ChatMessage[], index: number): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i]
    if (candidate.role === 'learner' && candidate.kind === 'message') return candidate.content
  }
  return null
}

/**
 * One recorded message, rendered by what it is. Only conversation text is a
 * selectable message; tool activity and notices are part of the record but
 * not something to branch from.
 */
function RecordedMessage({
  message,
  nodeId,
  highlighted = false,
  learnerText = null,
}: {
  message: ChatMessage
  nodeId: string
  highlighted?: boolean
  /** The learner message this one answered, for naming a command that ran with no reply. */
  learnerText?: string | null
}) {
  const graph = useWorkspaceStore((s) => s.graph)

  switch (message.kind) {
    case 'tool':
      return (
        <li>
          <ToolEntry title={message.content} />
        </li>
      )
    case 'permission_refused':
      return (
        <li>
          <PermissionRefusedNotice title={message.content} />
        </li>
      )
    case 'continuity_seam':
      return (
        <li>
          <ContinuitySeamNotice reason={message.content} />
        </li>
      )
    case 'practice_delivered':
      return (
        <li>
          <PracticeDeliveredEntry nodeId={nodeId} text={message.content} delivery={readDelivery(message.id, message.data)} />
        </li>
      )
    case 'practice_not_delivered':
      return (
        <li>
          <PracticeNotDeliveredNotice text={message.content} tool={readNotDelivered(message.data)} />
        </li>
      )
    case 'settings_notice':
      return (
        <li>
          <SettingsNotice text={message.content} />
        </li>
      )
    case 'message':
      break
  }

  if (message.role === 'agent' && message.outcome === 'completed' && !message.content.trim()) {
    return (
      <li className="flex flex-col" data-message-id={message.id}>
        <span className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {ROLE_LABELS.agent}
        </span>
        <EmptyReply learnerText={learnerText} />
      </li>
    )
  }

  const stubs = threadsAnchoredTo(graph, message.id)
  return (
    <li className="flex flex-col">
      <span className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {ROLE_LABELS[message.role]}
      </span>
      {/*
        The content element holds the message text and nothing else.
        Stubs render as siblings below it rather than inline at the
        anchor: any extra text inside this element would shift the
        character offsets a `SelectionAnchor` is measured in.
      */}
      <p
        {...{ [MESSAGE_CONTENT_ATTR]: '' }}
        data-message-id={message.id}
        data-highlighted={highlighted ? 'true' : undefined}
        className={`whitespace-pre-wrap rounded text-sm leading-relaxed text-gray-800 transition-colors duration-700 ${
          highlighted ? 'bg-yellow-100' : ''
        }`}
      >
        {message.content}
      </p>
      <OutcomeBadge outcome={message.outcome} />
      {stubs.length > 0 ? (
        <ul className="flex flex-col items-start">
          {stubs.map((stub) => (
            <li key={stub.id}>
              <ThreadStub thread={stub} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default NodeConversation
