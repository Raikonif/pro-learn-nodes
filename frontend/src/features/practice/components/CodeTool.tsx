import { useEffect, useState } from 'react'

import type { PracticeAttempt, PracticeItem, RunOutcomeKind } from '../practice-api'
import { bufferKey, usePracticeStore } from '../practice-store'
import { SandboxTool, type RunResult } from '../sandbox'
import { submissionFrom } from '../submission'

import SandboxPanel from './SandboxPanel'
import {
  AuthorMark,
  FormProblem,
  ToolLoading,
  ToolUnavailable,
  attemptCountLabel,
  buttonSecondary,
  cardClass,
  describeFailure,
  useIsHighlighted,
} from './ToolStates'

/**
 * A code block's body: the node's scratch buffer (`itemId` null), or one code
 * exercise solved in a buffer of its own. Each exercise is its own block, so
 * there is no picker here — the workbench is the list.
 */
function CodeTool({ nodeId, itemId }: { nodeId: string; itemId: string | null }) {
  return itemId === null ? <SandboxPanel nodeId={nodeId} /> : <ExercisePanel key={itemId} nodeId={nodeId} itemId={itemId} />
}

/** One exercise: its statement, its own buffer with Submit, and the latest submission. */
function ExercisePanel({ nodeId, itemId }: { nodeId: string; itemId: string }) {
  const key = bufferKey(nodeId, itemId)
  const material = usePracticeStore((s) => s.material[nodeId])
  const code = usePracticeStore((s) => s.buffers[key])
  const bufferLoad = usePracticeStore((s) => s.bufferLoads[key])
  const saveStatus = usePracticeStore((s) => s.sandboxSave[key])
  const openExerciseBuffer = usePracticeStore((s) => s.openExerciseBuffer)
  const editSandbox = usePracticeStore((s) => s.editSandbox)
  const flushSandbox = usePracticeStore((s) => s.flushSandbox)
  const submitExercise = usePracticeStore((s) => s.submitExercise)
  const [problem, setProblem] = useState<string | null>(null)
  const highlighted = useIsHighlighted(nodeId, itemId)

  useEffect(() => {
    void openExerciseBuffer(nodeId, itemId)
  }, [nodeId, itemId, openExerciseBuffer])

  const item = material?.status === 'ready' ? material.items.find((i) => i.id === itemId) : undefined
  if (!item) return <ToolLoading>Loading this exercise…</ToolLoading>

  const attempts = material?.status === 'ready' ? material.attempts.filter((a) => a.itemId === itemId) : []

  async function submit({ code: ran, result }: { code: string; result: RunResult }) {
    setProblem(null)
    try {
      await submitExercise(nodeId, itemId, submissionFrom(ran, result))
    } catch (error) {
      setProblem(describeFailure(error, 'Your submission could not be recorded.'))
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <section
        aria-label="Exercise"
        data-practice-item-id={item.id}
        data-highlighted={highlighted ? 'true' : undefined}
        className={`flex flex-col gap-1 p-2 text-xs ${cardClass(highlighted)}`}
      >
        <AuthorMark author={item.authoredBy} />
        <p className="whitespace-pre-wrap break-words text-gray-900">{item.prompt}</p>
        {item.expectedOutput !== null && (
          <div data-testid="expected-output" className="flex flex-col gap-1">
            <p className="text-gray-500">Expected output</p>
            <pre className="whitespace-pre-wrap break-words rounded bg-gray-50 p-1 font-mono text-gray-800">
              {item.expectedOutput}
            </pre>
          </div>
        )}
      </section>

      {code === undefined ? (
        bufferLoad?.status === 'failed' ? (
          <ToolUnavailable
            what="This exercise's code could not be loaded."
            reason={bufferLoad.reason}
            onRetry={() => void openExerciseBuffer(nodeId, itemId)}
          />
        ) : (
          <ToolLoading>Loading this exercise's code…</ToolLoading>
        )
      ) : (
        <SandboxTool
          key={key}
          nodeId={nodeId}
          code={code}
          onCodeChange={(next: string) => editSandbox(nodeId, next, itemId)}
          onSubmit={(submission) => void submit(submission)}
        />
      )}

      {saveStatus === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <p className="text-red-700">Your code could not be saved.</p>
          <button type="button" onClick={() => void flushSandbox(nodeId, itemId)} className={buttonSecondary}>
            Retry saving
          </button>
        </div>
      )}
      <FormProblem message={problem} />

      <LatestSubmission item={item} attempts={attempts} />
    </div>
  )
}

const OUTCOME_TEXT: Record<RunOutcomeKind, string> = {
  completed: 'Ran to completion.',
  error: 'Ended with an error.',
  stopped: 'Stopped before it finished.',
  timed_out: 'Timed out.',
}

/**
 * The newest submission: how its run ended and what it printed, and — only
 * when the exercise names an expected output — whether it matched. Nothing
 * else is judged here: no score, no grade.
 */
function LatestSubmission({ item, attempts }: { item: PracticeItem; attempts: PracticeAttempt[] }) {
  const latest = attempts[0]
  if (!latest) return null
  return (
    <section
      aria-label="Latest submission"
      data-testid="latest-submission"
      className="flex flex-col gap-1 rounded border border-gray-200 p-2 text-xs"
    >
      <p className="text-gray-500">Your latest submission · {attemptCountLabel(attempts.length)}</p>
      {latest.runOutcome !== null && <p className="text-gray-800">{OUTCOME_TEXT[latest.runOutcome]}</p>}
      {latest.runOutput ? (
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-1 font-mono text-gray-800">
          {latest.runOutput}
        </pre>
      ) : (
        <p className="text-gray-500">It printed nothing.</p>
      )}
      {item.expectedOutput !== null && latest.correct !== null && (
        <p className={latest.correct ? 'font-medium text-green-700' : 'font-medium text-red-700'}>
          {latest.correct
            ? 'The output matched the expected output.'
            : 'The output did not match the expected output.'}
        </p>
      )}
    </section>
  )
}

export default CodeTool
