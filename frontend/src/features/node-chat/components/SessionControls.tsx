import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { ApiHttpError } from '../../../shared/lib/api-client'
import type { AgentSettingsPatch } from '../../../shared/lib/workspace-api'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { WorkspaceNode } from '../../../shared/lib/workspace-types'
import type { AgentOffer, AgentOption, ModeOption } from '../../settings'
import type { ContextUsage } from '../chat-api'
import type { SessionAgent } from '../hooks/use-session-agent'
import {
  MODE_GROUP_HELP,
  MODE_GROUP_LABELS,
  MODE_GROUP_ORDER,
  currentModeGroup,
  fastSwitch,
  formatTokens,
  modeGroupOf,
} from '../session-controls'
import { useSessionStore } from '../session-store'

type ChoiceKey = 'model' | 'effort' | 'fast' | 'mode'

const SELECT_CLASS =
  'max-w-[12rem] rounded border border-gray-300 bg-white px-1 py-0.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none'

function describe(error: unknown): string {
  if (error instanceof ApiHttpError) {
    const detail = (error.body as { detail?: unknown } | undefined)?.detail
    if (typeof detail === 'string' && detail) return detail
  }
  return error instanceof Error ? error.message : String(error)
}

function nameOf(option: AgentOption | ModeOption | null, value: string | null | undefined): string | null {
  if (!option || !value) return null
  return option.values.find((candidate) => candidate.value === value)?.name ?? value
}

/**
 * The open session's agent controls, in the conversation header (design.md
 * "The selector sits in the conversation header"): model, effort, fast mode
 * and permission mode, from what the agent last reported offering.
 *
 * Kept on one compact row — the "Session settings" toggle, the marker of a
 * mode that acts without asking, and the context usage — so the header stays
 * legible in a small window; the selects open beneath it.
 *
 * The marker follows the session's *current* mode, whoever set it: an agent's
 * own default can act without asking (Claude's was `auto`). It also shows
 * while such a mode is chosen but not yet applied, so confirming one marks the
 * session at once rather than after the next turn.
 */
function SessionControls({ node, agent }: { node: WorkspaceNode; agent: SessionAgent | null }) {
  const report = useSessionStore((s) => s.byNode[node.id])
  const setNodeAgentSettings = useWorkspaceStore((s) => s.setNodeAgentSettings)
  const [open, setOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panelId = useId()

  const offer = agent?.offer?.offer ?? null
  const known = offer?.known ? offer : null
  const chosen = node.agentSettings ?? {}
  const live = report?.state ?? null
  const recorded = node.agentState ?? null

  const group = currentModeGroup({
    live: live?.modeGroup ?? null,
    recorded: recorded?.modeGroup ?? null,
    chosen: chosen.mode ?? null,
    mode: known?.mode ?? null,
  })
  const chosenUnasked = known?.mode && chosen.mode ? modeGroupOf(known.mode, chosen.mode) === 'unasked' : false
  const actsUnasked = group === 'unasked' || chosenUnasked

  async function save(patch: AgentSettingsPatch): Promise<void> {
    setError(null)
    try {
      await setNodeAgentSettings(node.id, patch)
    } catch (caught) {
      setError(describe(caught))
    }
  }

  function choose(key: ChoiceKey, value: string): void {
    const next = value === '' ? null : value
    if (key === 'mode' && next !== null && known?.mode && modeGroupOf(known.mode, next) === 'unasked') {
      // Never sent before the learner confirms what it allows.
      setPendingMode(next)
      return
    }
    void save({ [key]: next })
  }

  function confirmMode(): void {
    if (pendingMode === null) return
    const mode = pendingMode
    setPendingMode(null)
    void save({ mode, confirmedUnasked: true })
  }

  const summary = known
    ? [nameOf(known.model, chosen.model), nameOf(known.effort, chosen.effort), nameOf(known.mode, chosen.mode)]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : ''

  return (
    <div data-testid="session-controls" className="mt-1 text-xs text-gray-600">
      <div className="flex flex-wrap items-center gap-2">
        {agent ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1 rounded px-1 py-0.5 font-medium text-gray-700 hover:bg-gray-100"
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
            Session settings
            {summary ? <span className="font-normal text-gray-500">· {summary}</span> : null}
          </button>
        ) : null}
        {actsUnasked ? (
          <span
            data-testid="acts-unasked-marker"
            title={MODE_GROUP_HELP.unasked}
            className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 font-semibold text-red-800"
          >
            ⚠ Acts without asking
          </span>
        ) : null}
        {report?.usage ? <ContextUsageMeter usage={report.usage} /> : null}
      </div>

      {open && agent ? (
        <div id={panelId} className="mt-1 rounded border border-gray-200 bg-gray-50 p-2">
          <SessionChoices
            agent={agent}
            offer={offer}
            chosen={chosen}
            fastNow={live?.fast ?? recorded?.fast ?? null}
            onChoose={choose}
          />
          {pendingMode !== null && known?.mode ? (
            <ConfirmUnasked
              name={nameOf(known.mode, pendingMode) ?? pendingMode}
              description={known.mode.values.find((v) => v.value === pendingMode)?.description ?? null}
              onConfirm={confirmMode}
              onCancel={() => setPendingMode(null)}
            />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-red-700">
          Could not save the choice: {error}
        </p>
      ) : null}
    </div>
  )
}

function SessionChoices({
  agent,
  offer,
  chosen,
  fastNow,
  onChoose,
}: {
  agent: SessionAgent
  offer: AgentOffer | null
  chosen: Partial<Record<ChoiceKey, string>>
  fastNow: string | null
  onChoose: (key: ChoiceKey, value: string) => void
}) {
  if (!offer) {
    if (agent.offer?.status === 'error') {
      return <p role="alert" className="text-red-700">Could not read what {agent.name} offers: {agent.offer.error}</p>
    }
    return <p className="text-gray-500">Reading what {agent.name} offers…</p>
  }
  if (!offer.known) {
    return (
      <p data-testid="offer-unknown" className="text-gray-500">
        Choices appear once the agent has been reached — send a message on {agent.name} first.
      </p>
    )
  }
  if (!offer.model && !offer.effort && !offer.fast && !offer.mode) {
    return <p className="text-gray-500">{agent.name} offers no choices for its sessions.</p>
  }
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      {offer.model ? (
        <ChoiceSelect label="Model" option={offer.model} value={chosen.model} onChange={(v) => onChoose('model', v)} />
      ) : null}
      {offer.effort ? (
        <ChoiceSelect label="Effort" option={offer.effort} value={chosen.effort} onChange={(v) => onChoose('effort', v)} />
      ) : null}
      {offer.fast ? (
        <FastChoice option={offer.fast} value={chosen.fast ?? fastNow ?? offer.fast.current} chosen={chosen.fast} onChange={(v) => onChoose('fast', v)} />
      ) : null}
      {offer.mode ? <ModeSelect option={offer.mode} value={chosen.mode} onChange={(v) => onChoose('mode', v)} /> : null}
    </div>
  )
}

function optionText(value: { name: string; description: string | null }): string {
  return value.description ? `${value.name} — ${value.description}` : value.name
}

/** "Agent default", naming the default when the agent reported one. */
function defaultText(option: AgentOption | ModeOption): string {
  const name = nameOf(option, option.current)
  return name ? `Agent default (${name})` : 'Agent default'
}

/** A chosen value the agent no longer offers, kept visible so the select does not lie. */
function StaleValue({ option, value }: { option: AgentOption | ModeOption; value: string | undefined }) {
  if (!value || option.values.some((candidate) => candidate.value === value)) return null
  return (
    <option value={value} disabled>
      {value} (no longer offered)
    </option>
  )
}

function ChoiceSelect({
  label,
  option,
  value,
  onChange,
}: {
  label: string
  option: AgentOption
  value: string | undefined
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="font-medium text-gray-700">
        {label}
      </label>
      <select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="">{defaultText(option)}</option>
        <StaleValue option={option} value={value} />
        {option.values.map((candidate) => (
          <option key={candidate.value} value={candidate.value} title={candidate.description ?? undefined}>
            {optionText(candidate)}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Fast mode as a switch when the agent offers a plain on/off pair; anything
 * else is offered as its values, like the other choices.
 */
function FastChoice({
  option,
  value,
  chosen,
  onChange,
}: {
  option: AgentOption
  value: string | null
  chosen: string | undefined
  onChange: (value: string) => void
}) {
  const id = useId()
  const values = fastSwitch(option)
  if (!values) return <ChoiceSelect label="Fast" option={option} value={chosen} onChange={onChange} />
  return (
    <div className="flex items-center gap-1">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={value === values.on}
        onChange={(event) => onChange(event.target.checked ? values.on : values.off)}
        className="h-3.5 w-3.5 accent-blue-600"
      />
      <label htmlFor={id} className="font-medium text-gray-700">
        Fast
      </label>
    </div>
  )
}

function ModeSelect({
  option,
  value,
  onChange,
}: {
  option: ModeOption
  value: string | undefined
  onChange: (value: string) => void
}) {
  const id = useId()
  const helpId = useId()
  const shown = value ?? option.current
  const group = shown ? modeGroupOf(option, shown) : null
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="font-medium text-gray-700">
          Permissions
        </label>
        <select
          id={id}
          value={value ?? ''}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{defaultText(option)}</option>
          <StaleValue option={option} value={value} />
          {MODE_GROUP_ORDER.map((name) => {
            const members = option.values.filter((candidate) => candidate.group === name)
            if (members.length === 0) return null
            return (
              <optgroup key={name} label={MODE_GROUP_LABELS[name]}>
                {members.map((candidate) => (
                  <option key={candidate.value} value={candidate.value} title={candidate.description ?? undefined}>
                    {optionText(candidate)}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
      </div>
      <p id={helpId} className="max-w-xs text-[11px] text-gray-500">
        {group ? `${MODE_GROUP_LABELS[group]}. ${MODE_GROUP_HELP[group]}` : null}
      </p>
    </div>
  )
}

/**
 * Asked before a mode that acts without asking is sent. In the app rather than
 * `window.confirm`, so it can say plainly what the mode allows; Cancel has
 * focus, so a stray Enter declines.
 */
function ConfirmUnasked({
  name,
  description,
  onConfirm,
  onCancel,
}: {
  name: string
  description: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const bodyId = useId()
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={onKeyDown}
      className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-red-900"
    >
      <p id={titleId} className="font-semibold">
        Let the agent act without asking?
      </p>
      <div id={bodyId}>
        <p>
          In “{name}”, the agent may act on your system without asking — running commands and changing
          files anywhere it can reach. Learn Nodes will not ask you first, and the session stays marked
          while this mode is active.
        </p>
        {description ? <p className="mt-0.5 text-red-800">{description}</p> : null}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-red-700 px-2 py-1 font-medium text-white hover:bg-red-800"
        >
          Allow acting without asking
        </button>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 bg-white px-2 py-1 font-medium text-gray-800 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** How full the session's context is, as the agent last reported it. */
function ContextUsageMeter({ usage }: { usage: ContextUsage }) {
  const used = Math.min(usage.used, usage.size)
  return (
    <span
      data-testid="context-usage"
      title={`${usage.used.toLocaleString()} of ${usage.size.toLocaleString()} context tokens in use`}
      className="flex items-center gap-1 text-gray-500"
    >
      <span>
        Context {formatTokens(usage.used)} / {formatTokens(usage.size)}
      </span>
      <meter
        aria-label="Context used"
        min={0}
        max={usage.size}
        low={usage.size * 0.7}
        high={usage.size * 0.9}
        optimum={0}
        value={used}
        className="h-1.5 w-14"
      />
    </span>
  )
}

export default SessionControls
