import { useState } from 'react'

import type { PracticeAttempt, PracticeItem, PracticeOption } from '../practice-api'
import { usePracticeStore } from '../practice-store'

import {
  FormProblem,
  AuthorMark,
  ToolLoading,
  ToolUnavailable,
  attemptCountLabel,
  cardClass,
  buttonPrimary,
  buttonSecondary,
  describeFailure,
  fieldClass,
  useIsHighlighted,
} from './ToolStates'

/**
 * Multiple-choice questions on the open node. Correctness is whatever the
 * backend computed for the attempt; this tool only shows it back, with the
 * designated correct option.
 */
function QuizTool({ nodeId }: { nodeId: string }) {
  const material = usePracticeStore((s) => s.material[nodeId])
  const load = usePracticeStore((s) => s.load)
  const [authoring, setAuthoring] = useState(false)

  if (!material || material.status === 'loading') {
    return <ToolLoading>Loading this node's quiz…</ToolLoading>
  }
  if (material.status === 'failed') {
    return (
      <ToolUnavailable
        what="This node's practice material could not be loaded."
        reason={material.reason}
        onRetry={() => void load(nodeId)}
      />
    )
  }

  const items = material.items.filter((item) => item.kind === 'multiple_choice')

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && !authoring && (
        <p className="text-xs text-gray-600">This node has no quiz questions yet.</p>
      )}

      {items.map((item) => (
        <ChoiceCard
          key={item.id}
          nodeId={nodeId}
          item={item}
          attempts={material.attempts.filter((attempt) => attempt.itemId === item.id)}
        />
      ))}

      {authoring ? (
        <ChoiceForm nodeId={nodeId} onDone={() => setAuthoring(false)} />
      ) : (
        <button type="button" onClick={() => setAuthoring(true)} className={`self-start ${buttonSecondary}`}>
          Write a quiz question
        </button>
      )}
    </div>
  )
}

const BLANK_OPTION: PracticeOption = { text: '', correct: false }

function ChoiceForm({ nodeId, onDone }: { nodeId: string; onDone: () => void }) {
  const author = usePracticeStore((s) => s.author)
  const [prompt, setPrompt] = useState('')
  const [options, setOptions] = useState<PracticeOption[]>([BLANK_OPTION, BLANK_OPTION])
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function updateOption(index: number, change: Partial<PracticeOption>) {
    setOptions(options.map((option, i) => (i === index ? { ...option, ...change } : option)))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      // The backend is the one judge of what is acceptable (two options,
      // exactly one correct); the form sends what was written and shows its
      // reason in place. Only rows left entirely blank are dropped.
      await author(nodeId, {
        kind: 'multiple_choice',
        prompt,
        options: options
          .filter((option) => option.text.trim() !== '' || option.correct)
          .map((option) => ({ text: option.text.trim(), correct: option.correct })),
      })
      onDone()
    } catch (error) {
      setProblem(describeFailure(error, 'The quiz question could not be saved.'))
      setBusy(false)
    }
  }

  return (
    <form
      aria-label="New quiz question"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-2 rounded border border-gray-200 p-2"
    >
      <label className="flex flex-col gap-1 text-xs text-gray-700">
        Question
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className={fieldClass} />
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs text-gray-700">Options — tick the correct one</legend>
        {options.map((option, index) => {
          const n = index + 1
          return (
            <div key={index} className="flex items-center gap-1">
              <input
                type="checkbox"
                aria-label={`Option ${n} is correct`}
                checked={option.correct}
                onChange={(e) => updateOption(index, { correct: e.target.checked })}
              />
              <input
                type="text"
                aria-label={`Option ${n}`}
                value={option.text}
                onChange={(e) => updateOption(index, { text: e.target.value })}
                className={`min-w-0 flex-1 ${fieldClass}`}
              />
              <button
                type="button"
                aria-label={`Remove option ${n}`}
                onClick={() => setOptions(options.filter((_, i) => i !== index))}
                className="px-1 text-xs text-gray-500 hover:text-red-700"
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setOptions([...options, BLANK_OPTION])}
          className="self-start text-xs text-blue-700 hover:underline"
        >
          Add option
        </button>
      </fieldset>

      <FormProblem message={problem} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={buttonPrimary}>
          Add quiz question
        </button>
        <button type="button" onClick={onDone} className={buttonSecondary}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function ChoiceCard({
  nodeId,
  item,
  attempts,
}: {
  nodeId: string
  item: PracticeItem
  /** This item's attempts, newest first. */
  attempts: PracticeAttempt[]
}) {
  const answer = usePracticeStore((s) => s.answer)
  const [chosen, setChosen] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = attempts[0]
  const highlighted = useIsHighlighted(nodeId, item.id)
  const correctIndex = item.options.findIndex((option) => option.correct)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (chosen === null) return
    setBusy(true)
    setProblem(null)
    try {
      await answer(nodeId, item.id, { chosenOption: chosen })
      setChosen(null)
    } catch (error) {
      setProblem(describeFailure(error, 'Your answer could not be recorded.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      aria-label={item.prompt}
      data-practice-item-id={item.id}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cardClass(highlighted)}
    >
      <AuthorMark author={item.authoredBy} />
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 whitespace-pre-wrap break-words font-medium text-gray-900">{item.prompt}</legend>
          {item.options.map((option, index) => (
            <label key={index} className="flex items-start gap-1 text-gray-800">
              <input
                type="radio"
                name={`choice-${item.id}`}
                checked={chosen === index}
                onChange={() => setChosen(index)}
                className="mt-0.5"
              />
              <span className="break-words">{option.text}</span>
            </label>
          ))}
        </fieldset>
        <FormProblem message={problem} />
        <button type="submit" disabled={busy || chosen === null} className={`self-start ${buttonPrimary}`}>
          {latest ? 'Answer again' : 'Submit answer'}
        </button>
      </form>

      {latest && (
        <div data-testid="latest-attempt" className="flex flex-col gap-1 border-t border-gray-100 pt-2">
          <p className="text-gray-500">Your latest answer · {attemptCountLabel(attempts.length)}</p>
          <p className="break-words text-gray-800">
            You chose: {latest.chosenOption !== null ? item.options[latest.chosenOption]?.text : '—'}
          </p>
          <p className={latest.correct ? 'font-medium text-green-700' : 'font-medium text-red-700'}>
            {latest.correct ? 'Your choice matched the correct option.' : 'Your choice did not match the correct option.'}
          </p>
          {correctIndex >= 0 && (
            <p className="break-words text-gray-800">Correct option: {item.options[correctIndex].text}</p>
          )}
        </div>
      )}
    </article>
  )
}

export default QuizTool
