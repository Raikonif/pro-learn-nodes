import { useState } from 'react'

import type { PracticeAttempt, PracticeItem } from '../practice-api'
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
 * Free-response questions on the open node.
 *
 * Nothing here evaluates text: a submission is recorded and shown back, and a
 * reference answer — when the item has one — is revealed for the learner to
 * compare against. No score, mark, or pass/fail is ever rendered.
 */
function QuestionsTool({ nodeId }: { nodeId: string }) {
  const material = usePracticeStore((s) => s.material[nodeId])
  const load = usePracticeStore((s) => s.load)
  const [authoring, setAuthoring] = useState(false)

  if (!material || material.status === 'loading') {
    return <ToolLoading>Loading this node's questions…</ToolLoading>
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

  const items = material.items.filter((item) => item.kind === 'free_response')

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && !authoring && (
        <p className="text-xs text-gray-600">This node has no questions yet.</p>
      )}

      {items.map((item) => (
        <FreeResponseCard
          key={item.id}
          nodeId={nodeId}
          item={item}
          attempts={material.attempts.filter((attempt) => attempt.itemId === item.id)}
        />
      ))}

      {authoring ? (
        <FreeResponseForm nodeId={nodeId} onDone={() => setAuthoring(false)} />
      ) : (
        <button type="button" onClick={() => setAuthoring(true)} className={`self-start ${buttonSecondary}`}>
          Write a question
        </button>
      )}
    </div>
  )
}

function FreeResponseForm({ nodeId, onDone }: { nodeId: string; onDone: () => void }) {
  const author = usePracticeStore((s) => s.author)
  const [prompt, setPrompt] = useState('')
  const [referenceAnswer, setReferenceAnswer] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const reference = referenceAnswer.trim()
      await author(nodeId, {
        kind: 'free_response',
        prompt,
        ...(reference ? { referenceAnswer: reference } : {}),
      })
      onDone()
    } catch (error) {
      setProblem(describeFailure(error, 'The question could not be saved.'))
      setBusy(false)
    }
  }

  return (
    <form
      aria-label="New question"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-2 rounded border border-gray-200 p-2"
    >
      <label className="flex flex-col gap-1 text-xs text-gray-700">
        Question
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-700">
        Reference answer (optional)
        <textarea
          value={referenceAnswer}
          onChange={(e) => setReferenceAnswer(e.target.value)}
          rows={2}
          className={fieldClass}
        />
      </label>
      <FormProblem message={problem} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={buttonPrimary}>
          Add question
        </button>
        <button type="button" onClick={onDone} className={buttonSecondary}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function FreeResponseCard({
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
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = attempts[0]
  const highlighted = useIsHighlighted(nodeId, item.id)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await answer(nodeId, item.id, { response: draft })
      setDraft('')
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
      <p className="whitespace-pre-wrap break-words font-medium text-gray-900">{item.prompt}</p>

      {latest && (
        <div data-testid="latest-attempt" className="flex flex-col gap-1">
          <p className="text-gray-500">
            Your latest answer · {attemptCountLabel(attempts.length)}
          </p>
          <p className="whitespace-pre-wrap break-words rounded bg-gray-50 p-1 text-gray-800">
            {latest.response}
          </p>
          {item.referenceAnswer !== null && (
            <div data-testid="reference-answer" className="flex flex-col gap-1">
              <p className="text-gray-500">Reference answer, to compare with yours</p>
              <p className="whitespace-pre-wrap break-words rounded border border-gray-200 p-1 text-gray-800">
                {item.referenceAnswer}
              </p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-gray-700">
          {latest ? 'Answer again' : 'Your answer'}
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className={fieldClass} />
        </label>
        <FormProblem message={problem} />
        <button type="submit" disabled={busy || draft.trim() === ''} className={`self-start ${buttonPrimary}`}>
          Submit answer
        </button>
      </form>
    </article>
  )
}

export default QuestionsTool
