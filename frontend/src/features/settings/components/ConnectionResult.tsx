import type { AgentPreset, ConnectionStage, ConnectionTest } from '../agents-api'

/**
 * What each stage means for the learner, since the fix differs per stage:
 * install the agent, update it, or log in to it.
 */
export const STAGE_DESCRIPTIONS: Record<ConnectionStage, string> = {
  launch: 'the command could not be started — is the agent installed?',
  negotiate: 'the agent started but did not complete the protocol handshake',
  authenticate: 'the agent is not logged in',
}

type LoginInstructionsProps = {
  preset: AgentPreset | undefined
  authMethods: ConnectionTest['authMethods']
}

/**
 * How to log in, as text only.
 *
 * Deliberately no input of any kind: the agent authenticates through its own
 * mechanism, outside this application, and a field here would be an offer to
 * handle a credential this application must never touch.
 */
export function LoginInstructions({ preset, authMethods }: LoginInstructionsProps) {
  return (
    <div data-testid="login-instructions" className="mt-1 space-y-1 text-xs text-gray-700">
      <p>Log in through the agent itself, then test again.</p>
      {preset ? <p className="font-mono text-[11px] text-gray-800">{preset.loginHint}</p> : null}
      {authMethods.length > 0 ? (
        <>
          <p>The agent offers these ways to log in:</p>
          <ul className="list-disc pl-5">
            {authMethods.map((method) => (
              <li key={method.id}>
                {method.name}
                {method.description ? ` — ${method.description}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="text-gray-500">Learn Nodes never asks for, stores, or reads your credentials.</p>
    </div>
  )
}

type ConnectionResultProps = {
  result: ConnectionTest
  preset: AgentPreset | undefined
}

/** A staged connection test: which step failed and why, or who answered. */
function ConnectionResult({ result, preset }: ConnectionResultProps) {
  if (result.ok) {
    const identity = result.agent
      ? [result.agent.title || result.agent.name, result.agent.version].filter(Boolean).join(' ')
      : 'the agent'
    return (
      <div role="status" className="mt-2 rounded border border-green-200 bg-green-50 p-2 text-xs text-green-900">
        <p className="font-medium">Connected to {identity}.</p>
        <p>
          {result.capabilities?.loadSession
            ? 'Resumes sessions after a restart (loadSession supported).'
            : 'Cannot resume sessions (loadSession not supported) — after a restart the conversation is re-established from its record.'}
        </p>
      </div>
    )
  }

  return (
    <div role="alert" className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900">
      <p className="font-medium">
        {result.stage
          ? `Failed at the ${result.stage} stage: ${STAGE_DESCRIPTIONS[result.stage]}.`
          : 'The connection test failed.'}
      </p>
      {result.message ? <p className="mt-0.5 font-mono text-[11px]">{result.message}</p> : null}
      {result.stage === 'authenticate' ? (
        <LoginInstructions preset={preset} authMethods={result.authMethods} />
      ) : null}
    </div>
  )
}

export default ConnectionResult
