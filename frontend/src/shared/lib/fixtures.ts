import type {
  ChatMessage,
  ChatThread,
  NodeLink,
  SelectionAnchor,
  WorkspaceGraph,
  WorkspaceNode,
} from './workspace-types'

/**
 * Fixture graph the workspace renders against until the Phase 2 data model
 * lands. Shaped to exercise the cases the specs care about:
 *
 *   - a shared child with two parents (Functors under both Haskell and
 *     Category Theory), each edge carrying its own anchor — the case a single
 *     `parent_id` + `fork_point` pair cannot express
 *   - a thread spawned from a passage, and a further thread nested inside it
 *   - one anchor whose excerpt no longer matches its source, for the stale path
 */

function message(
  id: string,
  threadId: string,
  role: ChatMessage['role'],
  content: string,
  createdAt: string,
): ChatMessage {
  return {
    id,
    threadId,
    role,
    content,
    createdAt,
    kind: 'message',
    outcome: role === 'agent' ? 'completed' : null,
    data: null,
  }
}

/**
 * Build an anchor by locating `phrase` in the message rather than hand-writing
 * offsets. Throws at module load if the phrase is absent, so an edit to a
 * fixture message can never silently leave an anchor pointing at nothing.
 */
function anchorAt(msg: ChatMessage, phrase: string): SelectionAnchor {
  const start = msg.content.indexOf(phrase)
  if (start < 0) {
    throw new Error(`Fixture anchor phrase not found in ${msg.id}: "${phrase}"`)
  }
  return { messageId: msg.id, start, end: start + phrase.length, excerpt: phrase }
}

/**
 * An anchor whose offsets are real but whose stored excerpt no longer matches
 * what sits there — the shape left behind when a correction rewrites the
 * source passage. Exercises the stale branch of `resolveAnchor`.
 */
function staleAnchorAt(
  msg: ChatMessage,
  currentPhrase: string,
  originalExcerpt: string,
): SelectionAnchor {
  const anchor = anchorAt(msg, currentPhrase)
  return { ...anchor, excerpt: originalExcerpt }
}

// ── Nodes ────────────────────────────────────────────────────────────────
// `lastActivityAt` drives session-history ordering: Functors, Haskell,
// Category Theory, Lazy Evaluation, then Functional Programming.

export const NODE_FP: WorkspaceNode = {
  id: 'n-fp',
  title: 'Functional Programming',
  mode: 'Explore',
  body: '# Functional Programming\n\nThe root of this study graph.',
  activeSkills: ['study-coach'],
  mcpServers: [],
  createdAt: '2026-08-01T09:00:00.000Z',
  backendAgentId: null,
  lastOpenedAt: '2026-08-01T09:40:00.000Z',
  lastActivityAt: '2026-08-01T09:40:00.000Z',
  titleSource: 'topic',
}

export const NODE_HASKELL: WorkspaceNode = {
  id: 'n-haskell',
  title: 'Haskell',
  mode: 'Deepen',
  body: '# Haskell\n\nLaziness, thunks, and where the cost shows up.',
  activeSkills: ['study-coach', 'code-explainer'],
  mcpServers: ['filesystem'],
  createdAt: '2026-08-02T10:00:00.000Z',
  backendAgentId: null,
  lastOpenedAt: '2026-08-12T14:05:00.000Z',
  lastActivityAt: '2026-08-12T14:05:00.000Z',
  titleSource: 'topic',
}

export const NODE_CATEGORY_THEORY: WorkspaceNode = {
  id: 'n-cat',
  title: 'Category Theory',
  mode: 'Deepen',
  body: '# Category Theory\n\nStructure-preserving maps and why they recur.',
  activeSkills: ['study-coach'],
  mcpServers: [],
  createdAt: '2026-08-03T11:00:00.000Z',
  backendAgentId: null,
  lastOpenedAt: '2026-08-10T16:20:00.000Z',
  lastActivityAt: '2026-08-10T16:20:00.000Z',
  titleSource: 'topic',
}

export const NODE_FUNCTORS: WorkspaceNode = {
  id: 'n-functors',
  title: 'Functors',
  mode: 'Quiz',
  body: '# Functors\n\nReached from both Haskell and Category Theory.',
  activeSkills: ['quiz-master'],
  mcpServers: [],
  createdAt: '2026-08-05T12:00:00.000Z',
  backendAgentId: null,
  lastOpenedAt: '2026-08-14T18:30:00.000Z',
  lastActivityAt: '2026-08-14T18:30:00.000Z',
  titleSource: 'topic',
}

export const NODE_LAZY_EVALUATION: WorkspaceNode = {
  id: 'n-lazy-evaluation',
  title: 'Lazy Evaluation',
  mode: 'Deepen',
  body: '# Lazy Evaluation\n\nFollow the cost of deferred work from thunks to space leaks.',
  activeSkills: ['study-coach', 'code-explainer'],
  mcpServers: ['filesystem'],
  createdAt: '2026-08-06T13:00:00.000Z',
  backendAgentId: null,
  lastOpenedAt: '2026-08-04T15:10:00.000Z',
  lastActivityAt: '2026-08-04T15:10:00.000Z',
  titleSource: 'topic',
}

export const FIXTURE_NODES: WorkspaceNode[] = [
  NODE_FP,
  NODE_HASKELL,
  NODE_CATEGORY_THEORY,
  NODE_FUNCTORS,
  NODE_LAZY_EVALUATION,
]

// ── Main threads ─────────────────────────────────────────────────────────

export const THREAD_FP_MAIN: ChatThread = {
  id: 't-fp-main',
  nodeId: 'n-fp',
  name: 'main',
  anchor: null,
}

export const THREAD_HASKELL_MAIN: ChatThread = {
  id: 't-haskell-main',
  nodeId: 'n-haskell',
  name: 'main',
  anchor: null,
}

export const THREAD_CAT_MAIN: ChatThread = {
  id: 't-cat-main',
  nodeId: 'n-cat',
  name: 'main',
  anchor: null,
}

export const THREAD_FUNCTORS_MAIN: ChatThread = {
  id: 't-functors-main',
  nodeId: 'n-functors',
  name: 'main',
  anchor: null,
}

export const THREAD_LAZY_EVALUATION_MAIN: ChatThread = {
  id: 't-lazy-evaluation-main',
  nodeId: 'n-lazy-evaluation',
  name: 'main',
  anchor: null,
}

// ── Messages ─────────────────────────────────────────────────────────────

const M_FP_1 = message(
  'm-fp-1',
  't-fp-main',
  'learner',
  'What actually unifies functional programming as a field?',
  '2026-08-01T09:00:10.000Z',
)

const M_FP_2 = message(
  'm-fp-2',
  't-fp-main',
  'agent',
  'Functional programming is organised around evaluating expressions rather than executing statements. Three ideas recur: immutability, first-class functions, and referential transparency.',
  '2026-08-01T09:00:30.000Z',
)

const M_FP_3 = message(
  'm-fp-3',
  't-fp-main',
  'learner',
  'Where should I start?',
  '2026-08-01T09:35:00.000Z',
)

const M_FP_4 = message(
  'm-fp-4',
  't-fp-main',
  'agent',
  'Haskell is the strictest teacher, and category theory explains why the abstractions line up the way they do.',
  '2026-08-01T09:35:20.000Z',
)

const M_HS_1 = message(
  'm-hs-1',
  't-haskell-main',
  'learner',
  'Explain lazy evaluation.',
  '2026-08-02T10:00:10.000Z',
)

const M_HS_2 = message(
  'm-hs-2',
  't-haskell-main',
  'agent',
  'Haskell defers evaluation until a value is needed. Unevaluated expressions are held as thunks on the heap, which is what lets you define infinite lists and consume only the part you use.',
  '2026-08-02T10:00:40.000Z',
)

const M_HS_3 = message(
  'm-hs-3',
  't-haskell-main',
  'learner',
  'And the cost?',
  '2026-08-02T10:04:00.000Z',
)

const M_HS_4 = message(
  'm-hs-4',
  't-haskell-main',
  'agent',
  'Space leaks. A thunk chain can retain far more memory than the value it eventually produces. Once that clicks, functors are the next abstraction worth your time.',
  '2026-08-02T10:04:30.000Z',
)

const M_CT_1 = message(
  'm-ct-1',
  't-cat-main',
  'learner',
  'Why does category theory keep coming up?',
  '2026-08-03T11:00:10.000Z',
)

const M_CT_2 = message(
  'm-ct-2',
  't-cat-main',
  'agent',
  'It gives one vocabulary for structure-preserving maps. Functors, natural transformations, and monads are the parts that reach programming most directly.',
  '2026-08-03T11:00:35.000Z',
)

const M_FN_1 = message(
  'm-fn-1',
  't-functors-main',
  'learner',
  'Give me the one-sentence version of a functor.',
  '2026-08-05T12:00:10.000Z',
)

const M_FN_2 = message(
  'm-fn-2',
  't-functors-main',
  'agent',
  'A functor maps objects and arrows from one category to another while preserving identity and composition.',
  '2026-08-05T12:00:30.000Z',
)

const M_FN_3 = message(
  'm-fn-3',
  't-functors-main',
  'learner',
  'And in Haskell terms?',
  '2026-08-05T12:02:00.000Z',
)

const M_FN_4 = message(
  'm-fn-4',
  't-functors-main',
  'agent',
  'A type constructor with an fmap that respects those same two laws.',
  '2026-08-05T12:02:20.000Z',
)

const M_LE_1 = message(
  'm-le-1',
  't-lazy-evaluation-main',
  'learner',
  'Why defer evaluation instead of computing everything immediately?',
  '2026-08-06T13:00:10.000Z',
)

const M_LE_2 = message(
  'm-le-2',
  't-lazy-evaluation-main',
  'agent',
  'Deferring work lets a program avoid values it never uses, but retained thunks can also create space leaks when they hold onto more data than expected.',
  '2026-08-06T13:00:35.000Z',
)

// ── Spawned threads ──────────────────────────────────────────────────────
// A thread anchored inside a main-thread message, and a further thread
// anchored inside that thread — both on the same node, invisible to the graph.

export const THREAD_HASKELL_THUNKS: ChatThread = {
  id: 't-haskell-thunks',
  nodeId: 'n-haskell',
  name: 'thunks',
  anchor: anchorAt(M_HS_2, 'thunks on the heap'),
}

const M_TH_1 = message(
  'm-th-1',
  't-haskell-thunks',
  'learner',
  'Wait, what exactly is a thunk?',
  '2026-08-12T14:00:10.000Z',
)

const M_TH_2 = message(
  'm-th-2',
  't-haskell-thunks',
  'agent',
  'A thunk is a suspended computation: a closure holding the expression plus the environment it needs, evaluated at most once and then overwritten with its result.',
  '2026-08-12T14:00:40.000Z',
)

export const THREAD_HASKELL_ONCE: ChatThread = {
  id: 't-haskell-once',
  nodeId: 'n-haskell',
  name: 'evaluated at most once',
  anchor: anchorAt(M_TH_2, 'evaluated at most once'),
}

const M_ON_1 = message(
  'm-on-1',
  't-haskell-once',
  'learner',
  "How is 'at most once' actually enforced?",
  '2026-08-12T14:03:00.000Z',
)

const M_ON_2 = message(
  'm-on-2',
  't-haskell-once',
  'agent',
  'The runtime overwrites the thunk in place with an indirection to the computed value the first time it is forced, so every later reference reads the result rather than re-running the expression.',
  '2026-08-12T14:03:40.000Z',
)

/**
 * A thread whose anchor has gone stale: the offsets are real, but the source
 * message now reads "preserving identity and composition" where the anchor
 * still remembers the phrasing it was branched from.
 */
export const THREAD_FUNCTORS_STALE: ChatThread = {
  id: 't-functors-laws',
  nodeId: 'n-functors',
  name: 'which laws exactly',
  anchor: staleAnchorAt(
    M_FN_2,
    'preserving identity and composition',
    'preserving structure and the functor laws',
  ),
}

const M_LW_1 = message(
  'm-lw-1',
  't-functors-laws',
  'learner',
  'Which laws are we actually talking about?',
  '2026-08-14T18:25:00.000Z',
)

// ── Links ────────────────────────────────────────────────────────────────
// Functors is reached from BOTH Haskell and Category Theory, each edge
// carrying its own anchor into its own parent's conversation.

export const FIXTURE_LINKS: NodeLink[] = [
  {
    id: 'l-fp-haskell',
    parentId: 'n-fp',
    childId: 'n-haskell',
    anchor: anchorAt(M_FP_4, 'Haskell is the strictest teacher'),
  },
  {
    id: 'l-fp-cat',
    parentId: 'n-fp',
    childId: 'n-cat',
    anchor: anchorAt(M_FP_4, 'category theory explains why'),
  },
  {
    id: 'l-haskell-functors',
    parentId: 'n-haskell',
    childId: 'n-functors',
    anchor: anchorAt(M_HS_4, 'functors are the next abstraction'),
  },
  {
    id: 'l-cat-functors',
    parentId: 'n-cat',
    childId: 'n-functors',
    anchor: anchorAt(M_CT_2, 'Functors, natural transformations'),
  },
  {
    id: 'l-haskell-lazy-evaluation',
    parentId: 'n-haskell',
    childId: 'n-lazy-evaluation',
    anchor: anchorAt(M_HS_4, 'Space leaks'),
  },
]

export const FIXTURE_THREADS: ChatThread[] = [
  THREAD_FP_MAIN,
  THREAD_HASKELL_MAIN,
  THREAD_HASKELL_THUNKS,
  THREAD_HASKELL_ONCE,
  THREAD_CAT_MAIN,
  THREAD_FUNCTORS_MAIN,
  THREAD_LAZY_EVALUATION_MAIN,
  THREAD_FUNCTORS_STALE,
]

export const FIXTURE_MESSAGES: ChatMessage[] = [
  M_FP_1,
  M_FP_2,
  M_FP_3,
  M_FP_4,
  M_HS_1,
  M_HS_2,
  M_HS_3,
  M_HS_4,
  M_TH_1,
  M_TH_2,
  M_ON_1,
  M_ON_2,
  M_CT_1,
  M_CT_2,
  M_FN_1,
  M_FN_2,
  M_FN_3,
  M_FN_4,
  M_LE_1,
  M_LE_2,
  M_LW_1,
]

export const FIXTURE_GRAPH: WorkspaceGraph = {
  nodes: FIXTURE_NODES,
  links: FIXTURE_LINKS,
  threads: FIXTURE_THREADS,
  messages: FIXTURE_MESSAGES,
}

// ── Selectors ────────────────────────────────────────────────────────────

export function threadsForNode(graph: WorkspaceGraph, nodeId: string): ChatThread[] {
  return graph.threads.filter((t) => t.nodeId === nodeId)
}

export function mainThreadForNode(
  graph: WorkspaceGraph,
  nodeId: string,
): ChatThread | undefined {
  return graph.threads.find((t) => t.nodeId === nodeId && t.anchor === null)
}

export function messagesForThread(graph: WorkspaceGraph, threadId: string): ChatMessage[] {
  return graph.messages.filter((m) => m.threadId === threadId)
}

export function messageById(graph: WorkspaceGraph, messageId: string) {
  return graph.messages.find((m) => m.id === messageId)
}

export function nodeById(graph: WorkspaceGraph, nodeId: string) {
  return graph.nodes.find((n) => n.id === nodeId)
}

/** Threads spawned from a message, for rendering stubs at their anchors. */
export function threadsAnchoredTo(graph: WorkspaceGraph, messageId: string): ChatThread[] {
  return graph.threads.filter((t) => t.anchor?.messageId === messageId)
}

/** Parents of a node. More than one is expected — Functors has two. */
export function parentsOf(graph: WorkspaceGraph, nodeId: string): string[] {
  return graph.links.filter((l) => l.childId === nodeId).map((l) => l.parentId)
}
