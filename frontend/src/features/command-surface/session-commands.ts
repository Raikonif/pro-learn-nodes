import type { AgentOption } from '../settings'
import { modeGroupOf, useSessionOffer, type SessionOfferView } from '../node-chat'
import { useWorkspaceStore } from '../../shared/lib/workspace-store'

import { NEEDS_OFFER, NEEDS_OPEN_SESSION, SESSION_GROUP, UNASKED_MODE_REASON, type Command } from './types'

type Control = 'model' | 'effort' | 'fast' | 'mode'

const LABELS: Record<Control, string> = { model: 'Model', effort: 'Effort', fast: 'Fast mode', mode: 'Mode' }

/** Placeholders listed while nothing is offered, so the learner still finds where the choice lives. */
const PLACEHOLDER_TITLES: Record<Control, string> = {
  model: 'Session model',
  effort: 'Session effort',
  fast: 'Session fast mode',
  mode: 'Session permission mode',
}

function choose(nodeId: string, control: Control, value: string): void {
  // The same setter the session controls call. Their error line is not on
  // screen once the palette has closed; the choice then simply stays as it
  // was, which the controls show, so the rejection is dropped.
  void useWorkspaceStore
    .getState()
    .setNodeAgentSettings(nodeId, { [control]: value })
    .catch(() => undefined)
}

function valueCommands(
  nodeId: string,
  control: Control,
  option: AgentOption,
  current: string | null,
  reasonFor: (value: string) => string | undefined,
): Command[] {
  return option.values.map((value) => ({
    id: `session.${control}:${value.value}`,
    title: `${LABELS[control]}: ${value.name}`,
    group: SESSION_GROUP,
    description: [value.value === current ? 'Current choice' : null, value.description].filter(Boolean).join(' — ') || undefined,
    keywords: [LABELS[control], value.value],
    unavailable: reasonFor(value.value),
    run: () => choose(nodeId, control, value.value),
  }))
}

/**
 * The open session's model, effort, fast mode and permission mode, each value
 * the agent offers as a command that makes the choice the session controls
 * make. A mode that acts without asking is listed but not settable here: the
 * confirmation lives in the controls, in one place.
 *
 * With no node, or an agent that has not yet reported what it offers, the
 * four controls are listed once each, unavailable with the reason.
 */
export function useSessionCommands(openNodeId: string | null): Command[] {
  const offer = useSessionOffer(openNodeId)

  if (openNodeId === null || !offer || !offer.known) {
    const reason = openNodeId === null || !offer ? NEEDS_OPEN_SESSION : NEEDS_OFFER
    return (Object.keys(LABELS) as Control[]).map((control) => ({
      id: `session.${control}`,
      title: PLACEHOLDER_TITLES[control],
      group: SESSION_GROUP,
      keywords: [LABELS[control]],
      unavailable: reason,
      run: () => undefined,
    }))
  }
  return offeredCommands(openNodeId, offer)
}

function offeredCommands(nodeId: string, offer: SessionOfferView): Command[] {
  const commands: Command[] = []
  if (offer.model) commands.push(...valueCommands(nodeId, 'model', offer.model, offer.chosen.model, () => undefined))
  if (offer.effort) commands.push(...valueCommands(nodeId, 'effort', offer.effort, offer.chosen.effort, () => undefined))
  if (offer.fast) commands.push(...valueCommands(nodeId, 'fast', offer.fast, offer.chosen.fast, () => undefined))
  if (offer.mode) {
    const mode = offer.mode
    commands.push(
      ...valueCommands(nodeId, 'mode', mode, offer.chosen.mode, (value) =>
        modeGroupOf(mode, value) === 'unasked' ? UNASKED_MODE_REASON : undefined,
      ),
    )
  }
  return commands
}
