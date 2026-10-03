import type { Command } from './types'

/**
 * Matching and ranking for the palette: pure, no store, no React.
 *
 *   match(query, commands, nodes, openNodeId) → { commands: Page<Command>, nodes: Page<PaletteNode> }
 *
 * `Page` is `{ items, more }`: at most `PAGE_SIZE` results and how many
 * further ones matched, for the "+N more" line.
 *
 * With a query (design.md "Matching and ranking"): a command matches when the
 * query's characters appear in order, lowercased, in its title, group,
 * description or a keyword; a node, in its title. Quality is prefix > word
 * start > substring > subsequence, and any title match outranks a match
 * elsewhere. Commands list available before unavailable, then by quality,
 * then shorter title first. Archived nodes never match.
 *
 * With an empty (or blank) query ("Empty query"): the available commands in
 * group order — Workspace, Projects, Practice, Session, then an agent's — in the order
 * given within a group, then up to `RECENT_NODES` non-archived nodes by
 * `lastActivityAt`, newest first, leaving out the open one. `more` for nodes
 * is 0 there: the recents are a taste, not a truncated result.
 */

export const PAGE_SIZE = 8
export const RECENT_NODES = 5

/** The part of a node the palette needs; a `WorkspaceNode` satisfies it. */
export type PaletteNode = {
  id: string
  title: string
  lastActivityAt: string
  /** Set once a node is archived (node-projects-and-archive); such a node never matches. */
  archivedAt?: string | null
}

export type Page<T> = { items: T[]; more: number }

export type MatchResult = { commands: Page<Command>; nodes: Page<PaletteNode> }

const GROUP_ORDER = ['Workspace', 'Projects', 'Practice', 'Session']

/** An agent's group sorts after the application's own. */
function groupRank(group: string): number {
  const rank = GROUP_ORDER.indexOf(group)
  return rank < 0 ? GROUP_ORDER.length : rank
}

/** 0 for no match; 4 prefix, 3 word start, 2 substring, 1 subsequence. */
function quality(query: string, text: string): number {
  const haystack = text.toLowerCase()
  // A sigil is how a command is written, not how it is searched: `compact`
  // is a prefix of `/compact` and of `$archify`'s `archify`.
  const bare = haystack.replace(/^[/$]/, '')
  if (haystack.startsWith(query) || bare.startsWith(query)) return 4
  const at = haystack.indexOf(query)
  if (at >= 0) return /[^a-z0-9]/.test(haystack[at - 1] ?? ' ') ? 3 : 2
  let from = 0
  for (const char of query) {
    from = haystack.indexOf(char, from) + 1
    if (from === 0) return 0
  }
  return 1
}

/** A title match always outranks one in another field: titles score 10 and up. */
function commandScore(query: string, command: Command): number {
  const title = quality(query, command.title)
  if (title > 0) return title * 10
  const others = [command.group, command.description, ...(command.keywords ?? [])]
  return others.reduce((best, field) => Math.max(best, field ? quality(query, field) : 0), 0)
}

function page<T>(ranked: T[]): Page<T> {
  return { items: ranked.slice(0, PAGE_SIZE), more: Math.max(0, ranked.length - PAGE_SIZE) }
}

export function match(
  query: string,
  commands: Command[],
  nodes: PaletteNode[],
  openNodeId: string | null,
): MatchResult {
  const q = query.trim().toLowerCase()
  const live = nodes.filter((node) => !node.archivedAt)

  if (q === '') {
    const available = commands
      .map((command, index) => ({ command, index }))
      .filter(({ command }) => !command.unavailable)
      .sort((a, b) => groupRank(a.command.group) - groupRank(b.command.group) || a.index - b.index)
      .map(({ command }) => command)
    const recent = live
      .filter((node) => node.id !== openNodeId)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .slice(0, RECENT_NODES)
    return { commands: page(available), nodes: { items: recent, more: 0 } }
  }

  const rankedCommands = commands
    .map((command, index) => ({ command, index, score: commandScore(q, command) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        Number(Boolean(a.command.unavailable)) - Number(Boolean(b.command.unavailable)) ||
        b.score - a.score ||
        a.command.title.length - b.command.title.length ||
        a.index - b.index,
    )
    .map(({ command }) => command)

  const rankedNodes = live
    .map((node, index) => ({ node, index, score: quality(q, node.title) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.node.title.length - b.node.title.length ||
        b.node.lastActivityAt.localeCompare(a.node.lastActivityAt) ||
        a.index - b.index,
    )
    .map(({ node }) => node)

  return { commands: page(rankedCommands), nodes: page(rankedNodes) }
}
