import { create } from 'zustand'

import { useWorkspaceStore } from '../../shared/lib/workspace-store'
import type { ChatMessage, TurnOutcome } from '../../shared/lib/workspace-types'

import { revealDelivery } from '../practice'

import { usePermissionsStore } from '../permissions'

import {
  cancelTurn,
  streamTurn,
  type PermissionRequest,
  type PlanEntry,
  type PracticeDelivery,
  type TurnCommand,
  type TurnEvent,
  type TurnUsage,
} from './chat-api'
import { deliveryText } from './delivery'
import { nodeOfThread, useSessionStore } from './session-store'

/**
 * One visible piece of a turn in progress. Entries carrying an `id` are
 * recorded by the backend under that id as they arrive; entries without one
 * (a plan, or a message whose request never reached the backend) exist only
 * here.
 */
export type LiveEntry =
  | { type: 'learner'; key: string; id: string | null; text: string }
  | { type: 'agent'; key: string; id: string; text: string; thought: string }
  | {
      type: 'tool'
      key: string
      id: string
      toolCallId: string
      title: string
      kind: string | null
      status: string | null
    }
  | { type: 'plan'; key: string; entries: PlanEntry[] }
  | { type: 'permission_refused'; key: string; id: string; title: string }
  | {
      type: 'permission_decision'
      key: string
      id: string
      title: string
      kind: string | null
      allow: boolean
      remembered: boolean
    }
  | { type: 'continuity_seam'; key: string; id: string; reason: string }
  | { type: 'settings_notice'; key: string; id: string; text: string }
  | ({ type: 'practice_delivered'; key: string; id: string } & Omit<PracticeDelivery, 'messageId'>)

/**
 * `running` holds the composer; `stopping` has asked the agent to stop and
 * already frees the composer; `ended` has an outcome.
 */
export type TurnPhase = 'running' | 'stopping' | 'ended'

export type LiveTurn = {
  /** Distinguishes this run from a later one on the same thread. */
  runId: number
  threadId: string
  turnId: string | null
  phase: TurnPhase
  entries: LiveEntry[]
  outcome: TurnOutcome | null
  reason: string | null
  detail: string | null
  usage: TurnUsage | null
  /**
   * What the agent is asking and the learner has not answered. Not entries:
   * nothing is recorded until it is answered, and the answer is what stays.
   */
  permissions: PermissionRequest[]
  /** The recorded entries have been folded into the workspace graph. */
  settled: boolean
}

type TurnState = {
  turns: Record<string, LiveTurn>
  /** `command` marks a `/code`, `/qa` or `/quiz` message; `text` is still the message as typed. */
  send: (threadId: string, text: string, command?: TurnCommand) => Promise<void>
  stop: (threadId: string) => void
  /**
   * Drops a request this turn is showing: it was answered elsewhere, or no
   * longer exists. Its `permission.decided`, if any, still records the answer.
   */
  dismissPermission: (threadId: string, requestId: string) => void
  /** Test-only: forget every turn and abort any stream still open. */
  reset: () => void
}

/** How long a stopped turn may take to confirm before its stream is dropped. */
export const STOP_GRACE_MS = 5000

const controllers = new Map<number, AbortController>()
const stopTimers = new Map<number, ReturnType<typeof setTimeout>>()
let runCounter = 0

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError'
}

function apply(turn: LiveTurn, event: TurnEvent): LiveTurn {
  switch (event.type) {
    case 'turn.started':
      return {
        ...turn,
        turnId: event.turnId,
        entries: [
          ...turn.entries.map((entry) =>
            entry.type === 'learner' ? { ...entry, id: event.learnerMessageId } : entry,
          ),
          { type: 'agent', key: event.agentMessageId, id: event.agentMessageId, text: '', thought: '' },
        ],
      }
    case 'text':
    case 'thought': {
      const field = event.type === 'text' ? 'text' : 'thought'
      return {
        ...turn,
        entries: turn.entries.map((entry) =>
          entry.type === 'agent' ? { ...entry, [field]: entry[field] + event.text } : entry,
        ),
      }
    }
    case 'tool': {
      const existing = turn.entries.findIndex(
        (entry) => entry.type === 'tool' && entry.toolCallId === event.toolCallId,
      )
      const entry: LiveEntry = {
        type: 'tool',
        key: `tool-${event.toolCallId}`,
        id: event.messageId,
        toolCallId: event.toolCallId,
        title: event.title,
        kind: event.kind,
        status: event.status,
      }
      if (existing < 0) return { ...turn, entries: [...turn.entries, entry] }
      return { ...turn, entries: turn.entries.map((e, i) => (i === existing ? entry : e)) }
    }
    case 'plan': {
      // A plan is reported whole each time, so the latest replaces the last.
      const others = turn.entries.filter((entry) => entry.type !== 'plan')
      return { ...turn, entries: [...others, { type: 'plan', key: 'plan', entries: event.entries }] }
    }
    case 'permission.requested':
      if (turn.permissions.some((request) => request.requestId === event.requestId)) return turn
      {
        const { type: _type, ...request } = event
        return { ...turn, permissions: [...turn.permissions, request] }
      }
    case 'permission.decided': {
      const request = turn.permissions.find((r) => r.requestId === event.requestId)
      return {
        ...turn,
        permissions: turn.permissions.filter((r) => r.requestId !== event.requestId),
        entries: [
          ...turn.entries,
          {
            type: 'permission_decision',
            key: event.messageId,
            id: event.messageId,
            title: request?.title ?? '',
            kind: request?.kind ?? null,
            allow: event.allow,
            remembered: event.remembered,
          },
        ],
      }
    }
    case 'permission.refused':
      return {
        ...turn,
        entries: [
          ...turn.entries,
          { type: 'permission_refused', key: event.messageId, id: event.messageId, title: event.title },
        ],
      }
    case 'continuity.seam':
      return {
        ...turn,
        entries: [
          ...turn.entries,
          { type: 'continuity_seam', key: event.messageId, id: event.messageId, reason: event.reason },
        ],
      }
    case 'settings.notice':
      if (turn.entries.some((entry) => entry.type === 'settings_notice' && entry.id === event.messageId)) {
        return turn
      }
      return {
        ...turn,
        entries: [
          ...turn.entries,
          { type: 'settings_notice', key: event.messageId, id: event.messageId, text: event.text },
        ],
      }
    case 'practice.delivered': {
      // One record per tool per turn: a later event for the same message
      // carries the cumulative item ids and replaces the earlier line.
      const entry: LiveEntry = {
        type: 'practice_delivered',
        key: event.messageId,
        id: event.messageId,
        tool: event.tool,
        itemIds: event.itemIds,
        agentName: event.agentName,
      }
      const existing = turn.entries.findIndex(
        (e) => e.type === 'practice_delivered' && e.id === event.messageId,
      )
      if (existing < 0) return { ...turn, entries: [...turn.entries, entry] }
      return { ...turn, entries: turn.entries.map((e, i) => (i === existing ? entry : e)) }
    }
    case 'usage': {
      const { type: _type, ...usage } = event
      return { ...turn, usage }
    }
    // Reported about the session, not the turn: kept per node by `send`.
    case 'session.state':
    case 'context.usage':
      return turn
    case 'turn.ended':
      // A request outlives nothing: whatever was still unanswered is withdrawn.
      return {
        ...turn,
        permissions: [],
        phase: 'ended',
        outcome: event.outcome,
        reason: event.reason,
        detail: event.detail,
      }
  }
}

/** The recorded messages a finished turn left behind, as the graph holds them. */
function recordedMessages(turn: LiveTurn): ChatMessage[] {
  const createdAt = new Date().toISOString()
  const base = { threadId: turn.threadId, createdAt }
  return turn.entries.flatMap((entry): ChatMessage[] => {
    switch (entry.type) {
      case 'learner':
        return entry.id
          ? [{ ...base, id: entry.id, role: 'learner', content: entry.text, kind: 'message', outcome: null }]
          : []
      case 'agent':
        return [
          { ...base, id: entry.id, role: 'agent', content: entry.text, kind: 'message', outcome: turn.outcome },
        ]
      case 'tool':
        return [{ ...base, id: entry.id, role: 'agent', content: entry.title, kind: 'tool', outcome: null }]
      case 'permission_refused':
        return [
          { ...base, id: entry.id, role: 'agent', content: entry.title, kind: 'permission_refused', outcome: null },
        ]
      case 'permission_decision':
        return [
          {
            ...base,
            id: entry.id,
            role: 'agent',
            content: entry.title,
            kind: 'permission_decision',
            outcome: entry.allow ? null : 'refused',
            data: { allow: entry.allow, kind: entry.kind, remembered: entry.remembered },
          },
        ]
      case 'continuity_seam':
        return [
          { ...base, id: entry.id, role: 'agent', content: entry.reason, kind: 'continuity_seam', outcome: null },
        ]
      case 'settings_notice':
        return [
          { ...base, id: entry.id, role: 'agent', content: entry.text, kind: 'settings_notice', outcome: null },
        ]
      case 'practice_delivered':
        return [
          {
            ...base,
            id: entry.id,
            role: 'agent',
            content: deliveryText(entry),
            kind: 'practice_delivered',
            outcome: null,
            data: { tool: entry.tool, itemIds: entry.itemIds },
          },
        ]
      case 'plan':
        return []
    }
  })
}

/**
 * Practice delivered during a turn takes over the rail only when the turn's
 * session is the one on screen. The open stream always is — but the check is
 * what keeps a delivery from ever moving the rail of a different session.
 */
function revealIfOnScreen(threadId: string, delivery: PracticeDelivery): void {
  const workspace = useWorkspaceStore.getState()
  const nodeId = workspace.graph.threads.find((thread) => thread.id === threadId)?.nodeId
  if (nodeId === undefined || nodeId !== workspace.openNodeId) return
  revealDelivery({ nodeId, tool: delivery.tool, messageId: delivery.messageId, itemIds: delivery.itemIds })
}

/** Keeps what the turn reported about its session, against the session's node. */
function recordSessionReport(
  threadId: string,
  event: Extract<TurnEvent, { type: 'session.state' | 'context.usage' }>,
): void {
  const nodeId = nodeOfThread(threadId)
  if (nodeId === undefined) return
  if (event.type === 'session.state') {
    const { type: _type, ...state } = event
    useSessionStore.getState().record(nodeId, { state })
  } else {
    useSessionStore.getState().record(nodeId, { usage: { used: event.used, size: event.size } })
  }
}

function hasId(entry: LiveEntry): boolean {
  return 'id' in entry && entry.id !== null
}

export const useTurnStore = create<TurnState>((set, get) => {
  /** Applies `update` only while `runId` is still the thread's current run. */
  function update(threadId: string, runId: number, change: (turn: LiveTurn) => LiveTurn): void {
    const turn = get().turns[threadId]
    if (!turn || turn.runId !== runId) return
    set({ turns: { ...get().turns, [threadId]: change(turn) } })
  }

  function release(runId: number): void {
    controllers.delete(runId)
    const timer = stopTimers.get(runId)
    if (timer) clearTimeout(timer)
    stopTimers.delete(runId)
  }

  return {
    turns: {},

    send: async (threadId, text, command) => {
      const previous = get().turns[threadId]
      if (previous?.phase === 'running') throw new Error('A turn is already running in this thread')
      // A stopped turn that has not confirmed yet is dropped: its content is
      // already recorded server-side and arrives with the next snapshot.
      if (previous) controllers.get(previous.runId)?.abort()

      const runId = ++runCounter
      const controller = new AbortController()
      controllers.set(runId, controller)
      set({
        turns: {
          ...get().turns,
          [threadId]: {
            runId,
            threadId,
            turnId: null,
            phase: 'running',
            entries: [{ type: 'learner', key: `learner-${runId}`, id: null, text }],
            outcome: null,
            reason: null,
            detail: null,
            usage: null,
            permissions: [],
            settled: false,
          },
        },
      })

      try {
        for await (const event of streamTurn(threadId, text, controller.signal, command)) {
          update(threadId, runId, (turn) => apply(turn, event))
          if (event.type === 'practice.delivered' && get().turns[threadId]?.runId === runId) {
            revealIfOnScreen(threadId, event)
          }
          if (event.type === 'session.state' || event.type === 'context.usage') {
            recordSessionReport(threadId, event)
          }
          if (event.type === 'permission.decided') usePermissionsStore.getState().forget(event.requestId)
          if (event.type === 'permission.requested' || event.type === 'permission.decided') {
            void usePermissionsStore.getState().refreshPending()
          }
        }
      } catch (error) {
        update(threadId, runId, (turn) => {
          if (turn.outcome) return turn
          if (turn.turnId === null && !isAbort(error)) {
            // The request never became a turn: nothing was recorded.
            return { ...turn, outcome: 'failed', reason: 'request_failed', detail: describe(error) }
          }
          return turn
        })
      } finally {
        release(runId)
      }

      // The stream is over. Without a `turn.ended`, the turn is either one the
      // learner stopped (and whose confirmation was abandoned) or one whose
      // connection dropped — recorded content survives it, marked incomplete.
      const unanswered = get().turns[threadId]?.runId === runId ? get().turns[threadId].permissions : []
      for (const request of unanswered) usePermissionsStore.getState().forget(request.requestId)
      update(threadId, runId, (turn) => {
        if (turn.outcome) return { ...turn, permissions: [], phase: 'ended' }
        return {
          ...turn,
          permissions: [],
          phase: 'ended',
          outcome: turn.phase === 'stopping' ? 'cancelled' : 'incomplete',
          reason: turn.phase === 'stopping' ? null : 'connection_lost',
        }
      })

      const finished = get().turns[threadId]
      if (!finished || finished.runId !== runId) return
      const settling = useWorkspaceStore.getState().settleTurn(recordedMessages(finished))
      // The recorded entries now live in the graph; keep only what the graph
      // cannot hold (a plan, or a message that never reached the backend).
      update(threadId, runId, (turn) => ({
        ...turn,
        settled: true,
        entries: turn.entries.filter((entry) => !hasId(entry)),
      }))
      try {
        await settling
      } catch {
        // The re-read failed; the locally folded record stays until the next.
      }
    },

    stop: (threadId) => {
      const turn = get().turns[threadId]
      if (!turn || turn.phase !== 'running') return
      const { runId, turnId } = turn
      // Stopping withdraws what the turn was asking: there is no turn left to answer.
      for (const request of turn.permissions) usePermissionsStore.getState().forget(request.requestId)
      update(threadId, runId, (t) => ({ ...t, phase: 'stopping', permissions: [] }))
      const abort = () => controllers.get(runId)?.abort()
      if (turnId === null) {
        // Nothing to cancel server-side yet; dropping the request is all there is.
        abort()
        return
      }
      cancelTurn(turnId).catch(abort)
      // The cancel should end the stream with `turn.ended { cancelled }`; if
      // it does not arrive, stop listening rather than hold the turn open.
      stopTimers.set(runId, setTimeout(abort, STOP_GRACE_MS))
    },

    dismissPermission: (threadId, requestId) => {
      const turn = get().turns[threadId]
      if (!turn) return
      update(threadId, turn.runId, (t) => ({
        ...t,
        permissions: t.permissions.filter((request) => request.requestId !== requestId),
      }))
    },

    reset: () => {
      for (const controller of controllers.values()) controller.abort()
      for (const timer of stopTimers.values()) clearTimeout(timer)
      controllers.clear()
      stopTimers.clear()
      set({ turns: {} })
    },
  }
})

/** Ids of messages the live turn is still showing itself, not yet settled. */
export function liveMessageIds(turn: LiveTurn | undefined): Set<string> {
  const ids = new Set<string>()
  if (!turn) return ids
  for (const entry of turn.entries) {
    if ('id' in entry && entry.id) ids.add(entry.id)
  }
  return ids
}

/** Whether any conversation has a turn in progress — when an agent may ask. */
export function useAnyTurnRunning(): boolean {
  return useTurnStore((s) => Object.values(s.turns).some((turn) => turn.phase === 'running'))
}
