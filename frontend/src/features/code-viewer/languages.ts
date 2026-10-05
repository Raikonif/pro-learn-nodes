import type { Parser } from '@lezer/common'
import { parser as cssParser } from '@lezer/css'
import { parser as htmlParser } from '@lezer/html'
import { parser as javascriptParser } from '@lezer/javascript'
import { parser as jsonParser } from '@lezer/json'
import { parser as markdownParser } from '@lezer/markdown'
import { parser as pythonParser } from '@lezer/python'

/** The languages the viewer colours and checks. Anything else is shown as plain text. */
export type LanguageId = 'python' | 'javascript' | 'typescript' | 'json' | 'html' | 'css' | 'markdown'

export const LANGUAGE_LABELS: Record<LanguageId, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  markdown: 'Markdown',
}

const PARSERS: Record<LanguageId, Parser> = {
  python: pythonParser,
  // JSX is accepted in both: a `.js` file may hold it, and a `.tsx` one does.
  javascript: javascriptParser.configure({ dialect: 'jsx' }),
  typescript: javascriptParser.configure({ dialect: 'ts jsx' }),
  json: jsonParser,
  html: htmlParser,
  css: cssParser,
  markdown: markdownParser,
}

export function parserFor(language: LanguageId): Parser {
  return PARSERS[language]
}

const ALIASES: Record<string, LanguageId> = {
  python: 'python', py: 'python', python3: 'python',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  json: 'json',
  html: 'html', htm: 'html',
  css: 'css',
  markdown: 'markdown', md: 'markdown',
}

/** A language from a name, a fence's info string (`python title="x"`), or a file extension. */
export function languageOf(name: string | null | undefined): LanguageId | null {
  if (!name) return null
  const word = name.trim().split(/[\s{,]/)[0].toLowerCase()
  return ALIASES[word] ?? null
}

/** A language from a file path's extension. */
export function languageOfPath(path: string): LanguageId | null {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? null : languageOf(path.slice(dot + 1))
}
