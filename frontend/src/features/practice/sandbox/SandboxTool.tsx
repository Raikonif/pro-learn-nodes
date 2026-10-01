import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react'

import { ToolUnavailable, buttonPrimary, buttonSecondary } from '../components/ToolStates'

import {
  RESULT_DISPLAY_MAX_CHARS,
  RESULT_DISPLAY_MAX_LINES,
  truncateOutput,
} from './result-truncation'
import type { OutputChunk, RunOutcome, RunResult } from './sandbox-protocol'
import { SandboxBusyError, getSharedSandboxRunner, type SandboxRunner } from './sandbox-runner'

export type SandboxToolProps = {
  nodeId: string
  /** The persisted buffer, owned by the practice store. */
  code: string
  /** Called on every edit; the store persists it (debounced). */
  onCodeChange: (code: string) => void
  /** Injectable for tests; defaults to the app-wide runner, created lazily. */
  runner?: SandboxRunner
  /**
   * When given, a Submit control runs the buffer like Run and, once the run
   * has finished (however it ended), hands over the code it ran with its
   * result. Used by code exercises; the free sandbox has nothing to submit.
   */
  onSubmit?: (submission: { code: string; result: RunResult }) => void
}

/** What the result region shows; never persisted, never carried to another node. */
type View =
  | { kind: 'empty' }
  | { kind: 'running'; output: OutputChunk[] }
  | { kind: 'finished'; result: RunResult }
  | { kind: 'refused'; message: string }

function noop() {}

/**
 * The code sandbox: an editable Python buffer, a Run control that becomes
 * Stop while a run is in progress, and the run's result.
 *
 * Python executes in a worker (see `sandbox-runner.ts`), so a run never blocks
 * this thread and nothing outside this component is disabled while it runs.
 * The result lives only in component state: it is cleared when `nodeId`
 * changes, and a run still going when the node changes or the tool unmounts
 * is stopped — it belongs to code the learner is no longer looking at.
 */
export function SandboxTool({
  nodeId,
  code,
  onCodeChange,
  runner: injected,
  onSubmit,
}: SandboxToolProps): JSX.Element {
  const [runner] = useState(() => injected ?? getSharedSandboxRunner())
  const runtime = useSyncExternalStore(runner.subscribe, runner.getState)
  const [view, setView] = useState<View>({ kind: 'empty' })
  // Identifies the run this component started; results for any other are dropped.
  const runToken = useRef(0)

  // The runtime is loaded when the tool is first shown, not at app start.
  useEffect(() => {
    runner.prepare().catch(noop)
  }, [runner])

  // A new node starts with no result, and this node's run (if any) ends.
  useEffect(() => {
    return () => {
      if (runToken.current !== 0) {
        runToken.current = 0
        runner.stop()
      }
      setView({ kind: 'empty' })
    }
  }, [nodeId, runner])

  async function run(submit = false) {
    const ran = code
    const token = Date.now() + Math.random()
    runToken.current = token
    const live: OutputChunk[] = []
    setView({ kind: 'running', output: [] })
    try {
      const result = await runner.run(ran, {
        onOutput: (chunk) => {
          if (runToken.current !== token) return
          live.push(chunk)
          setView({ kind: 'running', output: [...live] })
        },
      })
      if (runToken.current !== token) return
      setView({ kind: 'finished', result })
      if (submit) onSubmit?.({ code: ran, result })
    } catch (error) {
      if (runToken.current !== token) return
      if (error instanceof SandboxBusyError) {
        setView({ kind: 'refused', message: 'Another run is already in progress.' })
      } else {
        // Unavailable: the runtime state renders the explanation and Retry.
        setView({ kind: 'empty' })
      }
    } finally {
      if (runToken.current === token) runToken.current = 0
    }
  }

  const running = view.kind === 'running'
  const unavailable = runtime.status === 'unavailable' && !running

  return (
    <div data-testid="sandbox-tool" className="flex min-h-0 flex-col gap-2">
      <textarea
        aria-label="Python code"
        value={code}
        onChange={(event) => onCodeChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !running && !unavailable) {
            event.preventDefault()
            void run()
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={8}
        placeholder="# Write Python here, then Run."
        className="min-h-24 w-full resize-y rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs leading-5 text-gray-900 focus:border-blue-500 focus:outline-none"
      />

      {unavailable ? (
        <ToolUnavailable
          what="Python code cannot be run here."
          reason={runtime.unavailableReason ?? undefined}
          onRetry={() => runner.prepare().catch(noop)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <button type="button" onClick={() => runner.stop()} className={buttonSecondary}>
              Stop
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void run()} className={buttonPrimary}>
                Run
              </button>
              {onSubmit && (
                <button type="button" onClick={() => void run(true)} className={buttonSecondary}>
                  Submit
                </button>
              )}
            </>
          )}
          <StatusLine running={running} preparing={runtime.status === 'preparing'} hasRun={view.kind !== 'empty'} />
        </div>
      )}

      <ResultRegion view={view} />
    </div>
  )
}

function StatusLine({ running, preparing, hasRun }: { running: boolean; preparing: boolean; hasRun: boolean }) {
  // Between runs the next interpreter warms in the background; that is only
  // worth mentioning before the first run, or while a run waits on it.
  let text: string | null = null
  if (running) text = preparing ? 'Preparing Python…' : 'Running…'
  else if (preparing && !hasRun) text = 'Preparing Python…'
  if (text === null) return null
  return (
    <p role="status" className="text-xs text-gray-500">
      {text}
    </p>
  )
}

function ResultRegion({ view }: { view: View }) {
  return (
    <section
      aria-label="Run result"
      aria-live="polite"
      className="flex min-h-0 flex-col gap-1 overflow-y-auto rounded border border-gray-200 bg-white p-2 text-xs"
    >
      {view.kind === 'empty' && <p className="text-gray-400">Run the code to see its output here.</p>}
      {view.kind === 'refused' && <p className="text-gray-600">{view.message}</p>}
      {view.kind === 'running' && <Output chunks={view.output} forwardedTruncated={false} />}
      {view.kind === 'finished' && (
        <>
          <Output chunks={view.result.output} forwardedTruncated={view.result.outputTruncated} />
          <Outcome outcome={view.result.outcome} hasOutput={view.result.output.length > 0} />
        </>
      )}
    </section>
  )
}

function Output({ chunks, forwardedTruncated }: { chunks: OutputChunk[]; forwardedTruncated: boolean }) {
  if (chunks.length === 0 && !forwardedTruncated) return null
  const shown = truncateOutput(chunks)
  return (
    <>
      <pre
        data-testid="sandbox-output"
        className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-gray-900"
      >
        {shown.chunks.map((chunk, index) => (
          <span
            key={index}
            data-stream={chunk.stream}
            className={chunk.stream === 'stderr' ? 'text-red-700' : undefined}
          >
            {chunk.text}
          </span>
        ))}
      </pre>
      {(shown.truncated || forwardedTruncated) && (
        <p className="text-amber-700">
          Output truncated: only the first {RESULT_DISPLAY_MAX_LINES.toLocaleString('en-US')} lines or{' '}
          {RESULT_DISPLAY_MAX_CHARS.toLocaleString('en-US')} characters are shown.
        </p>
      )}
    </>
  )
}

function Outcome({ outcome, hasOutput }: { outcome: RunOutcome; hasOutput: boolean }) {
  switch (outcome.kind) {
    case 'completed':
      return <p className="text-gray-500">{hasOutput ? 'Completed.' : 'Completed with no output.'}</p>
    case 'stopped':
      return <p className="text-gray-600">Stopped by you.</p>
    case 'timed_out':
      return (
        <p className="text-amber-700">
          Timed out after {formatSeconds(outcome.limitMs)} — the limit for a single run.
        </p>
      )
    case 'error':
      return (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 font-mono text-red-800">
          <span className="font-semibold">{outcome.type}</span>
          {outcome.message && `: ${outcome.message}`}
          {outcome.line !== null && <span className="block text-red-700">on line {outcome.line}</span>}
        </div>
      )
  }
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`
}
