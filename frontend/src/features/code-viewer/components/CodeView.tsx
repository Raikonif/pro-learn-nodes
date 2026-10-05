import { useMemo } from 'react'

import { analyze, diagnosticLines, type Diagnostic, type Token } from '../highlight'
import { LANGUAGE_LABELS, type LanguageId } from '../languages'

/**
 * Token colours, by the classes the highlighter emits. Written out as whole
 * Tailwind classes on the container — arbitrary variants reaching the token
 * spans — so no stylesheet is injected and Tailwind's scanner sees every one.
 */
export const TOKEN_COLORS = [
  '[&_.tok-keyword]:text-violet-700 dark:[&_.tok-keyword]:text-violet-300',
  '[&_.tok-function]:text-blue-700 dark:[&_.tok-function]:text-blue-300',
  '[&_.tok-className]:font-semibold [&_.tok-className]:text-amber-700 dark:[&_.tok-className]:text-amber-300',
  '[&_.tok-typeName]:text-teal-700 dark:[&_.tok-typeName]:text-teal-300',
  '[&_.tok-namespace]:text-teal-700 dark:[&_.tok-namespace]:text-teal-300',
  '[&_.tok-string]:text-emerald-700 dark:[&_.tok-string]:text-emerald-300',
  '[&_.tok-string2]:text-emerald-600 dark:[&_.tok-string2]:text-emerald-400',
  '[&_.tok-number]:text-orange-700 dark:[&_.tok-number]:text-orange-300',
  '[&_.tok-bool]:text-orange-700 dark:[&_.tok-bool]:text-orange-300',
  '[&_.tok-atom]:text-orange-700 dark:[&_.tok-atom]:text-orange-300',
  '[&_.tok-comment]:italic [&_.tok-comment]:text-gray-500 dark:[&_.tok-comment]:text-gray-400',
  '[&_.tok-propertyName]:text-sky-700 dark:[&_.tok-propertyName]:text-sky-300',
  '[&_.tok-operator]:text-pink-700 dark:[&_.tok-operator]:text-pink-300',
  '[&_.tok-self]:text-rose-700 dark:[&_.tok-self]:text-rose-300',
  '[&_.tok-meta]:text-gray-600 dark:[&_.tok-meta]:text-gray-300',
  '[&_.tok-heading]:font-bold [&_.tok-heading]:text-blue-800 dark:[&_.tok-heading]:text-blue-200',
  '[&_.tok-emphasis]:italic [&_.tok-strong]:font-bold [&_.tok-link]:underline [&_.tok-url]:underline',
  '[&_.tok-invalid]:text-red-700',
].join(' ')

const ERROR_UNDERLINE = 'underline decoration-red-600 decoration-wavy underline-offset-2'

function overlaps(start: number, end: number, diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.from < Math.max(end, start + 1) && d.to > start)
}

function Line({
  tokens,
  number,
  start,
  diagnostics,
  marked,
}: {
  tokens: Token[]
  number: number
  start: number
  diagnostics: Diagnostic[]
  marked: boolean
}) {
  let at = start
  return (
    <div className="flex" data-line={number}>
      <span
        aria-hidden="true"
        className={`sticky left-0 w-12 shrink-0 select-none border-r border-gray-200 bg-gray-50 pr-2 text-right tabular-nums ${
          marked ? 'text-red-600' : 'text-gray-400'
        }`}
      >
        {marked ? (
          <span data-testid="diagnostic-marker" title="Syntax error" className="mr-1">
            ●
          </span>
        ) : null}
        {number}
      </span>
      <code className="whitespace-pre pl-3 pr-4">
        {tokens.map((token, index) => {
          const from = at
          at += token.text.length
          const error = diagnostics.length > 0 && overlaps(from, at, diagnostics)
          const className = [token.classes, error ? ERROR_UNDERLINE : null].filter(Boolean).join(' ')
          return (
            <span key={index} className={className || undefined} data-diagnostic={error ? 'true' : undefined}>
              {token.text}
            </span>
          )
        })}
        {tokens.length === 0 ? '​' : null}
      </code>
    </div>
  )
}

/**
 * Code, read-only: numbered lines coloured by what each token is, with the
 * syntax errors the parser found marked in the code, beside their line
 * numbers, and listed below. `compact` drops the notes and the list, for a
 * preview inside another surface.
 */
function CodeView({
  code,
  language,
  label,
  compact = false,
}: {
  code: string
  language: LanguageId | null
  /** What the code is, for assistive technology: a file name, an exercise. */
  label: string
  compact?: boolean
}) {
  const analysis = useMemo(() => analyze(code, language), [code, language])
  const marked = useMemo(() => diagnosticLines(code, analysis.diagnostics), [code, analysis.diagnostics])

  let offset = 0
  const lines = analysis.lines.map((tokens, index) => {
    const start = offset
    offset += tokens.reduce((sum, token) => sum + token.text.length, 0) + 1
    return (
      <Line
        key={index}
        tokens={tokens}
        number={index + 1}
        start={start}
        diagnostics={analysis.diagnostics}
        marked={marked.has(index + 1)}
      />
    )
  })

  return (
    <figure aria-label={label} data-testid="code-view" data-language={language ?? 'plain'} className="flex min-h-0 flex-col">
      {compact ? null : (
        <figcaption className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          <span className="font-medium text-gray-700">{language ? LANGUAGE_LABELS[language] : 'Plain text'}</span>
          {analysis.recognised ? null : (
            <span data-testid="language-not-recognised">Language not recognised — shown without colours or checks.</span>
          )}
          <span className="ml-auto">Read-only</span>
        </figcaption>
      )}
      <div
        className={`overflow-auto rounded border border-gray-200 bg-white py-1 font-mono text-xs leading-5 text-gray-900 ${TOKEN_COLORS} ${
          compact ? 'max-h-40' : 'min-h-0 flex-1'
        }`}
      >
        {lines}
      </div>
      {compact || !analysis.recognised ? null : (
        <div className="mt-1 text-[11px]" data-testid="diagnostics">
          <p className="text-gray-500">Syntax checks only.</p>
          {analysis.diagnostics.length === 0 ? (
            <p className="text-emerald-700">No syntax problems found.</p>
          ) : (
            <ul aria-label="Syntax problems" className="mt-0.5 flex flex-col gap-0.5 text-red-700">
              {analysis.diagnostics.map((d) => (
                <li key={d.from}>
                  Line {d.line}, column {d.column}: {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </figure>
  )
}

export default CodeView
