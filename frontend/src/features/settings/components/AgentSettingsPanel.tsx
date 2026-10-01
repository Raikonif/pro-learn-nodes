import { useEffect, useId, useState, type FormEvent } from 'react'

import { AgentRegistrationError, type Agent, type AgentPreset } from '../agents-api'
import { presetFor, useAgentsStore } from '../agents-store'

import ConnectionResult, { LoginInstructions, STAGE_DESCRIPTIONS } from './ConnectionResult'

const CUSTOM = '__custom__'

type Draft = { presetKey: string; name: string; command: string; args: string }

const EMPTY_DRAFT: Draft = { presetKey: CUSTOM, name: '', command: '', args: '' }

/** One argument per line, so an argument containing a space survives intact. */
function parseArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type RegistrationFailure =
  | { kind: 'staged'; error: AgentRegistrationError; preset: AgentPreset | undefined }
  | { kind: 'other'; message: string }

function RegistrationForm() {
  const presets = useAgentsStore((s) => s.presets)
  const register = useAgentsStore((s) => s.register)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<RegistrationFailure | null>(null)
  const ids = { preset: useId(), name: useId(), command: useId(), args: useId() }

  function choosePreset(key: string): void {
    const preset = presets.find((candidate) => candidate.key === key)
    // Prefill, never register: the learner can still edit every field.
    setDraft(
      preset
        ? { presetKey: key, name: preset.name, command: preset.command, args: preset.args.join('\n') }
        : { ...EMPTY_DRAFT },
    )
    setFailure(null)
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setPending(true)
    setFailure(null)
    try {
      await register({ name: draft.name.trim(), command: draft.command.trim(), args: parseArgs(draft.args) })
      setDraft(EMPTY_DRAFT)
    } catch (error) {
      setFailure(
        error instanceof AgentRegistrationError
          ? {
              kind: 'staged',
              error,
              preset:
                presets.find((p) => p.key === draft.presetKey) ??
                presetFor(
                  { name: draft.name, command: draft.command, args: parseArgs(draft.args) },
                  presets,
                ),
            }
          : { kind: 'other', message: describe(error) },
      )
    } finally {
      setPending(false)
    }
  }

  const inputClass =
    'w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none'

  return (
    <form aria-label="Register an agent" onSubmit={(event) => void submit(event)} className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">Add an agent</h3>
      <p className="text-xs text-gray-600">
        Name the command that launches an agent you have already installed and logged in to.
        Learn Nodes starts it; it never handles your account or credentials.
      </p>
      <div>
        <label htmlFor={ids.preset} className="block text-xs font-medium text-gray-700">
          Start from
        </label>
        <select
          id={ids.preset}
          value={draft.presetKey}
          onChange={(event) => choosePreset(event.target.value)}
          className={inputClass}
        >
          <option value={CUSTOM}>Custom command</option>
          {presets.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={ids.name} className="block text-xs font-medium text-gray-700">
          Name
        </label>
        <input
          id={ids.name}
          type="text"
          required
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={ids.command} className="block text-xs font-medium text-gray-700">
          Command
        </label>
        <input
          id={ids.command}
          type="text"
          required
          spellCheck={false}
          value={draft.command}
          onChange={(event) => setDraft({ ...draft, command: event.target.value })}
          className={`${inputClass} font-mono`}
        />
      </div>
      <div>
        <label htmlFor={ids.args} className="block text-xs font-medium text-gray-700">
          Arguments (one per line)
        </label>
        <textarea
          id={ids.args}
          rows={2}
          spellCheck={false}
          value={draft.args}
          onChange={(event) => setDraft({ ...draft, args: event.target.value })}
          className={`${inputClass} font-mono`}
        />
      </div>

      {failure ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900">
          {failure.kind === 'staged' ? (
            <>
              <p className="font-medium">
                {failure.error.stage
                  ? `Registration failed at the ${failure.error.stage} stage: ${STAGE_DESCRIPTIONS[failure.error.stage]}.`
                  : 'Registration failed.'}
              </p>
              <p className="mt-0.5 font-mono text-[11px]">{failure.error.message}</p>
              {failure.error.stage === 'authenticate' ? (
                <LoginInstructions preset={failure.preset} authMethods={[]} />
              ) : null}
            </>
          ) : (
            <p>Registration failed: {failure.message}</p>
          )}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? 'Connecting…' : 'Register agent'}
      </button>
    </form>
  )
}

function AgentRow({ agent }: { agent: Agent }) {
  const presets = useAgentsStore((s) => s.presets)
  const testState = useAgentsStore((s) => s.tests[agent.id])
  const test = useAgentsStore((s) => s.test)
  const remove = useAgentsStore((s) => s.remove)
  const makeDefault = useAgentsStore((s) => s.makeDefault)
  const [actionError, setActionError] = useState<string | null>(null)

  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(describe(error))
    }
  }

  const buttonClass =
    'rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60'

  return (
    <li aria-label={agent.name} className="rounded border border-gray-200 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
            {agent.name}
            {agent.isDefault ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-800">
                Default
              </span>
            ) : null}
          </p>
          <p className="truncate font-mono text-[11px] text-gray-500">
            {[agent.command, ...agent.args].join(' ')}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className={buttonClass}
            disabled={testState?.status === 'pending'}
            onClick={() => void test(agent.id)}
            aria-label={`Test ${agent.name}`}
          >
            {testState?.status === 'pending' ? 'Testing…' : 'Test'}
          </button>
          {agent.isDefault ? null : (
            <button
              type="button"
              className={buttonClass}
              onClick={() => void run(() => makeDefault(agent.id))}
              aria-label={`Make ${agent.name} the default`}
            >
              Make default
            </button>
          )}
          <button
            type="button"
            className={buttonClass}
            onClick={() => void run(() => remove(agent.id))}
            aria-label={`Remove ${agent.name}`}
          >
            Remove
          </button>
        </div>
      </div>
      {testState?.status === 'done' ? (
        <ConnectionResult result={testState.result} preset={presetFor(agent, presets)} />
      ) : null}
      {testState?.status === 'error' ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          Could not run the test: {testState.message}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {actionError}
        </p>
      ) : null}
    </li>
  )
}

/**
 * Agent configuration: the agents this account can run conversations on.
 *
 * A dialog over the workspace rather than a fourth pane — it is visited to set
 * something up and then left, not kept open beside a conversation.
 */
function AgentSettingsPanel() {
  const panelOpen = useAgentsStore((s) => s.panelOpen)
  const closePanel = useAgentsStore((s) => s.closePanel)
  const load = useAgentsStore((s) => s.load)
  const agents = useAgentsStore((s) => s.agents)
  const status = useAgentsStore((s) => s.status)
  const error = useAgentsStore((s) => s.error)
  const headingId = useId()

  useEffect(() => {
    if (panelOpen) void load()
  }, [panelOpen, load])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, closePanel])

  if (!panelOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl"
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 id={headingId} className="text-base font-semibold text-gray-900">
            Agents
          </h2>
          <button
            type="button"
            onClick={closePanel}
            className="rounded px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </header>

        <p data-testid="agent-context-access" className="mb-3 text-xs text-gray-600">
          Agents can read your sessions and practice, and propose memory, through Learn Nodes. A memory they
          propose is kept only if you accept it in Memory.
        </p>

        <section aria-label="Registered agents" className="mb-4">
          {status === 'error' ? (
            <p role="alert" className="text-sm text-red-700">
              Could not load agents: {error}
            </p>
          ) : agents.length === 0 ? (
            <p className="text-sm text-gray-600">
              {status === 'loading' ? 'Loading agents…' : 'No agent registered yet.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {agents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </ul>
          )}
        </section>

        <RegistrationForm />
      </div>
    </div>
  )
}

export default AgentSettingsPanel
