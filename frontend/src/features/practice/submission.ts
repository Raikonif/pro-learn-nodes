import type { CodeSubmission } from './practice-api'
import type { RunResult } from './sandbox'

/** The most of a run's output an attempt records; the backend keeps the same bound. */
export const RUN_OUTPUT_MAX_CHARS = 20_000

/**
 * What a code exercise's attempt records about a run: the code as run, how
 * the run ended, and what it printed — stdout and stderr in the order the
 * program wrote them, then an uncaught error's `Type: message` line, which
 * the harness reports beside the output rather than in it. Cut to
 * `RUN_OUTPUT_MAX_CHARS`.
 */
export function submissionFrom(code: string, result: RunResult): CodeSubmission {
  let runOutput = result.output.map((chunk) => chunk.text).join('')
  const { outcome } = result
  if (outcome.kind === 'error') {
    const line = outcome.message ? `${outcome.type}: ${outcome.message}` : outcome.type
    runOutput += `${runOutput === '' || runOutput.endsWith('\n') ? '' : '\n'}${line}\n`
  }
  return { code, runOutcome: outcome.kind, runOutput: runOutput.slice(0, RUN_OUTPUT_MAX_CHARS) }
}
