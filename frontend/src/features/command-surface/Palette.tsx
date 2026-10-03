import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { useWorkspaceStore } from '../../shared/lib/workspace-store'

import { match, type PaletteNode } from './match'
import { useCommands } from './registry'
import type { Command } from './types'

/** ⌘K on macOS, Ctrl+K elsewhere; with any other modifier it is someone else's shortcut. */
function isPaletteShortcut(event: KeyboardEvent | globalThis.KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== 'k' || event.shiftKey || event.altKey) return false
  const mac = /mac/i.test(navigator.platform)
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/**
 * The command palette: a ⌘K / Ctrl+K overlay over the three panes.
 *
 * Mount it once inside the signed-in workspace; that placement is what makes
 * the shortcut inert while signed out and keeps node results to the active
 * account's graph. The listener is on `window` in the capture phase and calls
 * `preventDefault`, so it opens with the composer focused and the keystroke
 * never reaches the composer's draft.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return open ? <PaletteDialog onClose={() => setOpen(false)} /> : null
}

/** One row of the listbox, command or node, in the order the keyboard walks them. */
type Entry =
  | { kind: 'command'; key: string; command: Command }
  | { kind: 'node'; key: string; node: PaletteNode }

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const commands = useCommands()
  const nodes = useWorkspaceStore((s) => s.graph.nodes)
  const openNodeId = useWorkspaceStore((s) => s.openNodeId)
  const openNode = useWorkspaceStore((s) => s.openNode)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const baseId = useId()
  const headingId = `${baseId}-title`
  const listId = `${baseId}-list`

  // What held focus before the palette took it, read during the first render
  // (before the input's autofocus effect), so closing can hand it back.
  const [previous] = useState(() => document.activeElement)
  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [previous])

  const result = useMemo(() => match(query, commands, nodes, openNodeId), [query, commands, nodes, openNodeId])
  const entries: Entry[] = [
    ...result.commands.items.map((command): Entry => ({ kind: 'command', key: `cmd:${command.id}`, command })),
    ...result.nodes.items.map((node): Entry => ({ kind: 'node', key: `node:${node.id}`, node })),
  ]
  // A result set can shrink under a highlight (an offer arriving, a node
  // archived) without the query changing; keep the highlight on a real row.
  const active = Math.min(highlight, entries.length - 1)
  const optionId = (key: string) => `${baseId}-${key}`
  const activeEntry = active >= 0 ? entries[active] : undefined

  useEffect(() => {
    if (!activeEntry) return
    document.getElementById(optionId(activeEntry.key))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntry?.key])

  function activate(entry: Entry | undefined): void {
    if (!entry) return
    if (entry.kind === 'command' && entry.command.unavailable) return
    // Close first, then run on the next frame: a command that moves focus
    // (placing text in the composer) must win over the focus restoration.
    onClose()
    const run = entry.kind === 'command' ? entry.command.run : () => openNode(entry.node.id)
    requestAnimationFrame(run)
  }

  function onKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      case 'ArrowDown':
        event.preventDefault()
        if (entries.length) setHighlight((active + 1) % entries.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (entries.length) setHighlight((active - 1 + entries.length) % entries.length)
        break
      case 'Enter':
        event.preventDefault()
        activate(activeEntry)
        break
      case 'Tab':
        // The query field is the dialog's only stop; focus stays inside it.
        event.preventDefault()
        break
    }
  }

  function renderEntry(entry: Entry) {
    const selected = activeEntry?.key === entry.key
    const unavailable = entry.kind === 'command' ? entry.command.unavailable : undefined
    return (
      <div
        key={entry.key}
        id={optionId(entry.key)}
        role="option"
        aria-selected={selected}
        aria-disabled={unavailable ? true : undefined}
        // Keep the query field focused: a click is not a focus change.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          const index = entries.findIndex((candidate) => candidate.key === entry.key)
          if (index !== active) setHighlight(index)
        }}
        onClick={() => activate(entry)}
        className={`flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm ${
          selected ? 'bg-blue-50 ring-1 ring-blue-200' : ''
        } ${unavailable ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer text-gray-900'}`}
      >
        {entry.kind === 'command' ? (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate font-medium">{entry.command.title}</span>
              <span className="shrink-0 text-xs text-gray-500">{entry.command.group}</span>
            </span>
            {entry.command.description ? (
              <span className="truncate text-xs text-gray-500">{entry.command.description}</span>
            ) : null}
            {unavailable ? <span className="text-xs italic text-gray-500">{unavailable}</span> : null}
          </>
        ) : (
          <span className="truncate font-medium">{entry.node.title}</span>
        )}
      </div>
    )
  }

  const commandEntries = entries.filter((entry) => entry.kind === 'command')
  const nodeEntries = entries.filter((entry) => entry.kind === 'node')

  return (
    <div
      data-testid="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={onKeyDown}
        className="flex max-h-[calc(100vh-4rem)] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <h2 id={headingId} className="sr-only">
          Command palette
        </h2>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search commands and nodes"
          aria-expanded={entries.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeEntry ? optionId(activeEntry.key) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          placeholder="Search commands and nodes…"
          className="shrink-0 border-b border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <div id={listId} role="listbox" aria-label="Results">
            {commandEntries.length > 0 ? (
              <ResultGroup label="Commands" labelId={`${baseId}-commands`} more={result.commands.more}>
                {commandEntries.map(renderEntry)}
              </ResultGroup>
            ) : null}
            {nodeEntries.length > 0 ? (
              <ResultGroup label="Nodes" labelId={`${baseId}-nodes`} more={result.nodes.more}>
                {nodeEntries.map(renderEntry)}
              </ResultGroup>
            ) : null}
          </div>
          {entries.length === 0 ? (
            <p role="status" className="px-3 py-6 text-center text-sm text-gray-500">
              Nothing matched
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ResultGroup({
  label,
  labelId,
  more,
  children,
}: {
  label: string
  labelId: string
  more: number
  children: React.ReactNode
}) {
  return (
    <div role="group" aria-labelledby={labelId} className="mb-1">
      <div id={labelId} role="presentation" className="px-2 pb-0.5 pt-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      {children}
      {more > 0 ? (
        <div role="presentation" className="px-2 py-1 text-xs text-gray-500">
          +{more} more
        </div>
      ) : null}
    </div>
  )
}
