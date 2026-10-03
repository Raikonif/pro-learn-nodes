import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import { parseCommand, suggestMenu, type MenuAgent } from '../commands'
import { useComposerRequest } from '../composer-request'
import { useTurnStore } from '../turn-store'

/**
 * Writes into the open thread. Sending starts a streaming turn; while it
 * runs, Send becomes Stop. Stopping frees the composer at once — the learner
 * does not wait for the agent to confirm before writing again.
 *
 * A message beginning with `/code`, `/qa` or `/quiz` asks for practice in
 * that tool: it is sent as typed, with the command named beside it. Typing
 * `/` offers the commands (arrows to move, Tab or Enter to complete, Esc to
 * dismiss).
 *
 * The menu also lists the commands the session's agent announced (`agent`),
 * under the agent's name — its skills, `/compact`, and so on. Choosing one
 * inserts it as announced; sending it is an ordinary message the agent
 * interprets, with no `command` beside it (agent-session-controls design.md
 * "The agent's commands are relayed, not reimplemented").
 */
function Composer({ threadId, agent = null }: { threadId: string; agent?: MenuAgent | null }) {
  const [draft, setDraft] = useState('')
  const phase = useTurnStore((s) => s.turns[threadId]?.phase)
  const send = useTurnStore((s) => s.send)
  const stop = useTurnStore((s) => s.stop)
  const running = phase === 'running'
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const focusRequested = useWorkspaceStore((s) => s.composerFocusRequested)
  const consumeFocus = useWorkspaceStore((s) => s.consumeComposerFocus)
  const [problem, setProblem] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const groups = dismissed ? [] : suggestMenu(draft, agent)
  const suggestions = groups.flatMap((group) => group.commands)
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0))
  const optionId = (index: number) => `${listId}-option-${index}`
  const showsAgent = groups.some((group) => group.source === 'agent')

  // A long agent list scrolls; keep the option the arrows reached in view.
  useEffect(() => {
    if (suggestions.length === 0) return
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, suggestions.length])

  // Text placed from elsewhere (the practice add control) replaces the draft
  // and waits for the learner, cursor at its end; nothing is sent.
  const placed = useComposerRequest((s) => s.request)
  const consumePlaced = useComposerRequest((s) => s.consume)
  useEffect(() => {
    if (!placed) return
    setDraft(placed.text)
    setDismissed(false)
    consumePlaced()
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    // After React has written the new value into the textarea.
    requestAnimationFrame(() => textarea.setSelectionRange(placed.text.length, placed.text.length))
  }, [placed, consumePlaced])

  // A session that was just created opens ready to write. The request is
  // consumed here, once, so remounting later never steals focus back.
  useEffect(() => {
    if (!focusRequested) return
    textareaRef.current?.focus()
    consumeFocus()
  }, [focusRequested, consumeFocus])

  function submit(event?: FormEvent): void {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || running) return
    const parsed = parseCommand(text)
    if (parsed && parsed.request === '') {
      // Refused in place: an empty request would leave the agent guessing.
      setProblem(`Say what to practise after /${parsed.command} — for example “/${parsed.command} folds in Haskell”.`)
      return
    }
    setDraft('')
    setProblem(null)
    void send(threadId, text, parsed?.command).catch(() => {
      // `send` refuses only while a turn is running, which `running` guards.
    })
  }

  function edit(next: string): void {
    setDraft(next)
    setProblem(null)
    setActive(0)
    // A dismissed menu stays away until the learner starts a new command.
    if (!next.startsWith('/')) setDismissed(false)
  }

  function complete(index: number): void {
    const choice = suggestions[index]
    if (!choice) return
    setDraft(`/${choice.name} `)
    setActive(0)
    textareaRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((activeIndex + step + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing)) {
        event.preventDefault()
        complete(activeIndex)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event)
  }

  return (
    <form
      aria-label="Send a message"
      onSubmit={submit}
      className="mt-4 flex flex-col gap-1 border-t border-gray-200 pt-3"
    >
      {suggestions.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          aria-label={showsAgent ? 'Commands' : 'Practice commands'}
          className="flex max-h-48 flex-col overflow-y-auto rounded border border-gray-200 bg-white py-1 text-xs shadow-sm"
        >
          {groups.map((group) => {
            const offset = suggestions.indexOf(group.commands[0])
            const labelId = `${listId}-${group.source}-label`
            return (
              <div key={group.source} role="group" aria-labelledby={labelId}>
                <div
                  id={labelId}
                  role="presentation"
                  className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400"
                >
                  {group.label}
                </div>
                {group.commands.map((command, position) => {
                  const index = offset + position
                  return (
                    <div
                      key={command.name}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === activeIndex}
                      // Keeps focus in the textarea while choosing with the pointer.
                      onMouseDown={(event) => {
                        event.preventDefault()
                        complete(index)
                      }}
                      className={`cursor-pointer px-2 py-1 ${index === activeIndex ? 'bg-blue-50 text-blue-900' : 'text-gray-700'}`}
                    >
                      <span className="font-mono font-semibold">/{command.name}</span>
                      {command.description ? (
                        <span className="ml-2 text-gray-500">{command.description}</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs text-red-700">
          {problem}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
      <textarea
        ref={textareaRef}
        aria-label="Message"
        aria-autocomplete="list"
        aria-controls={suggestions.length > 0 ? listId : undefined}
        aria-activedescendant={
          suggestions.length > 0 ? optionId(activeIndex) : undefined
        }
        rows={2}
        value={draft}
        onChange={(event) => edit(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write a message, or / for commands…"
        className="min-w-0 flex-1 resize-none rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
      />
      {running ? (
        <button
          type="button"
          onClick={() => stop(threadId)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      )}
      </div>
    </form>
  )
}

export default Composer
