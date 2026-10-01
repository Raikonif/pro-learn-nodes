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
  describeFailure,
  useIsHighlighted,
} from './ToolStates'

/**
 * The Code tool: the node's free sandbox and, when the node has any, its code
 * exercises — each solved in a buffer of its own.
 *
 * Which one is open is a view preference held per node in the practice store,
 * so a delivered exercise can be opened from outside this component.
 */
function CodeTool({ nodeId }: { nodeId: string }) {
  const material = usePracticeStore((s) => s.material[nodeId])
  const selected = usePracticeStore((s) => s.selectedExercise[nodeId] ?? null)
  const exercises =
    material?.status === 'ready' ? material.items.filter((item) => item.kind === 'code_exercise') : []

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {exercises.length > 0 && (
        <ExerciseList
          nodeId={nodeId}
          exercises={exercises}
          attempts={material?.status === 'ready' ? material.attempts : []}
          selected={selected}
        />
      )}
      {selected === null ? (
        <SandboxPanel nodeId={nodeId} />
      ) : (
        <ExercisePanel key={selected} nodeId={nodeId} itemId={selected} />
      )}
    </div>
  )
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '')?.trim() ?? text
}

const entryClass = (active: boolean, highlighted: boolean) =>
  `flex w-full flex-col items-start rounded border px-2 py-1 text-left text-xs transition-colors duration-700 ${
    highlighted
      ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300'
      : active
        ? 'border-blue-500 bg-blue-50'
        : 'border-gray-200 hover:bg-gray-50'
  }`

function ExerciseList({
  nodeId,
  exercises,
  attempts,
  selected,
}: {
  nodeId: string
  exercises: PracticeItem[]
  attempts: PracticeAttempt[]
  selected: string | null
}) {
  const selectExercise = usePracticeStore((s) => s.selectExercise)
  return (
    <ul aria-label="Code exercises" className="flex flex-col gap-1">
      <li>
        <button
          type="button"
          aria-pressed={selected === null}
          onClick={() => selectExercise(nodeId, null)}
          className={entryClass(selected === null, false)}
        >
          <span className="font-medium text-gray-900">Free sandbox</span>
        </button>
      </li>
      {exercises.map((exercise) => (
        <ExerciseEntry
          key={exercise.id}
          nodeId={nodeId}
          exercise={exercise}
          attemptCount={attempts.filter((attempt) => attempt.itemId === exercise.id).length}
          active={selected === exercise.id}
          onSelect={() => selectExercise(nodeId, exercise.id)}
        />
      ))}
    </ul>
  )
}

function ExerciseEntry({
  nodeId,
  exercise,
  attemptCount,
  active,
  onSelect,
}: {
  nodeId: string
  exercise: PracticeItem
  attemptCount: number
  active: boolean
  onSelect: () => void
}) {
  const highlighted = useIsHighlighted(nodeId, exercise.id)
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        data-practice-item-id={exercise.id}
        data-highlighted={highlighted ? 'true' : undefined}
        onClick={onSelect}
        className={entryClass(active, highlighted)}
      >
        <span className="w-full truncate font-medium text-gray-900">{firstLine(exercise.prompt)}</span>
        <span className="text-[10px] text-gray-500">
          {exercise.authoredBy ? `by ${exercise.authoredBy.name}` : 'You'} · {attemptCountLabel(attemptCount)}
        </span>
      </button>
    </li>
  )
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
      <section aria-label="Exercise" className="flex flex-col gap-1 rounded border border-gray-200 p-2 text-xs">
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
