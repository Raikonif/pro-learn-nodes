import { z } from 'zod'

/**
 * Domain contract for the workspace surfaces.
 *
 * The Phase 2 data model does not exist yet, so nothing here is fetched —
 * the workspace renders against `fixtures.ts`. These shapes ARE the contract
 * Phase 2 has to satisfy (see the change's design.md "Dependencies" table),
 * so keep them honest rather than convenient.
 */

/**
 * Points at a passage of a message that a branch was created from.
 *
 * `excerpt` is a stored copy of the selected text, not a derived read. That
 * redundancy is the whole point: Phase 9 corrections rewrite message text and
 * Phase 10 compaction collapses turns, so `start`/`end` rot against a moving
 * target. Keeping the text means a branch survives its own source changing —
 * it degrades to "stale" instead of dangling. See `anchor-resolver.ts`.
 */
export const SelectionAnchorSchema = z
  .object({
    messageId: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    excerpt: z.string().min(1),
  })
  .refine((a) => a.end > a.start, {
    message: 'Anchor end offset must be greater than start',
    path: ['end'],
  })

export type SelectionAnchor = z.infer<typeof SelectionAnchorSchema>

/**
 * Both message authors raise the branch affordance — a learner can branch
 * from their own phrasing just as readily as from the agent's.
 */
export const ChatRoleSchema = z.enum(['learner', 'agent'])
export type ChatRole = z.infer<typeof ChatRoleSchema>

/**
 * What a recorded message is. Only `message` is conversation text; the others
 * are entries an agent turn leaves in the record so reopening a node shows
 * what happened, not just what was said:
 *
 *   - `tool`: the agent invoked a tool (`content` is its title)
 *   - `permission_refused`: the agent asked to act and was refused
 *     (`content` names what it asked to do)
 *   - `continuity_seam`: the agent's session could not be resumed and the
 *     conversation was re-established from the record (`content` is why)
 *   - `practice_delivered`: an agent added practice to the rail during the
 *     turn (`content` says who sent how much to which tool; `data` carries
 *     `{ tool, itemIds }` so the record can lead back to it after a restart)
 *   - `practice_not_delivered`: a `/code`, `/qa` or `/quiz` turn ended with
 *     nothing delivered (`data`: `{ tool }`)
 *   - `settings_notice`: a session choice the agent no longer offers was not
 *     sent (`content` says which, and why)
 *
 * Defaulted so a snapshot from before agent backends still parses.
 */
export const MessageKindSchema = z.enum([
  'message',
  'tool',
  'permission_refused',
  'continuity_seam',
  'practice_delivered',
  'practice_not_delivered',
  'settings_notice',
])
export type MessageKind = z.infer<typeof MessageKindSchema>

/**
 * How an agent turn ended. `null` for a learner message. An agent message is
 * `incomplete` from the moment its turn starts until the turn ends, so a turn
 * whose connection dropped reads as incomplete on reopening.
 */
export const TurnOutcomeSchema = z.enum(['incomplete', 'completed', 'cancelled', 'refused', 'failed'])
export type TurnOutcome = z.infer<typeof TurnOutcomeSchema>

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: ChatRoleSchema,
  content: z.string(),
  createdAt: z.string().datetime(),
  kind: MessageKindSchema.default('message'),
  outcome: TurnOutcomeSchema.nullable().default(null),
  /**
   * Structured detail some kinds carry (see `MessageKindSchema`). Absent or
   * `null` otherwise — optional so a snapshot from before it existed, and
   * every message built locally, need not name it.
   */
  data: z.record(z.string(), z.unknown()).nullish(),
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>

/**
 * A conversation inside a node. A node owns one thread with `anchor: null`
 * (its `main` thread) plus any number of spawned threads, each anchored to the
 * passage it came from.
 *
 * `anchor === null` is the sole marker of the main thread rather than a
 * separate `isMain` flag — two representations of one fact drift apart, and
 * the spec already forbids the main thread from carrying an anchor.
 */
export const ChatThreadSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  name: z.string().min(1),
  anchor: SelectionAnchorSchema.nullable(),
})

export type ChatThread = z.infer<typeof ChatThreadSchema>

/** Mode shapes the agent's behavior per node. Mirrors tech-stack.md. */
export const NodeModeSchema = z.enum(['Deepen', 'Review', 'Practice', 'Quiz', 'Explore'])
export type NodeMode = z.infer<typeof NodeModeSchema>

/**
 * Where a node's title came from. Only `provisional` and `auto` titles are
 * ever rewritten by the backend; `topic` and `learner` are the learner's own
 * words and are kept.
 */
export const TitleSourceSchema = z.enum(['provisional', 'auto', 'topic', 'learner'])
export type TitleSource = z.infer<typeof TitleSourceSchema>

/**
 * How much a permission mode lets an agent do unasked (agent-session-controls
 * design.md "Permission modes are classified…"). Learn Nodes refuses every
 * permission request, so `asks` is effectively read-only; `edits` writes in
 * the session's folder; `unasked` acts on the learner's system.
 */
export const MODE_GROUPS = ['asks', 'edits', 'unasked'] as const
export type ModeGroup = (typeof MODE_GROUPS)[number]

/** Reads a group, putting anything unrecognised in the most permissive one. */
export function toModeGroup(value: unknown): ModeGroup {
  return (MODE_GROUPS as readonly unknown[]).includes(value) ? (value as ModeGroup) : 'unasked'
}

const choice = z.string().nullish()

/**
 * The learner's choices for a session's agent, values only. A control left out
 * runs on the agent's default; `null` on the wire means the same and is dropped.
 */
export const AgentSettingsSchema = z
  .object({ model: choice, effort: choice, fast: choice, mode: choice })
  .transform((settings) => {
    const kept: { model?: string; effort?: string; fast?: string; mode?: string } = {}
    for (const key of ['model', 'effort', 'fast', 'mode'] as const) {
      const value = settings[key]
      if (typeof value === 'string') kept[key] = value
    }
    return kept
  })

export type AgentSettings = z.infer<typeof AgentSettingsSchema>
export type AgentSettingKey = keyof AgentSettings

const reported = z.string().nullish().transform((v) => v ?? null)

/**
 * What the session actually ran with on its last turn. A mode with no group,
 * or an unrecognised group, reads as acting without asking.
 */
export const AgentStateSchema = z
  .object({
    model: reported,
    effort: reported,
    fast: reported,
    mode: reported,
    modeGroup: z.unknown(),
  })
  .transform(({ modeGroup, ...state }) => ({
    ...state,
    modeGroup:
      modeGroup == null && state.mode === null ? null : toModeGroup(modeGroup),
  }))

export type AgentState = z.infer<typeof AgentStateSchema>

/**
 * A session. Configuration (mode, skills, MCP) lives here and only here —
 * threads inherit it and cannot override it (design.md Decision 6).
 */
export const WorkspaceNodeSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    mode: NodeModeSchema,
    body: z.string(),
    activeSkills: z.array(z.string()),
    mcpServers: z.array(z.string()),
    createdAt: z.string().datetime(),
    lastOpenedAt: z.string().datetime(),
    /**
     * The registered agent this node's conversation runs on. `null` means the
     * node has not chosen one and its next turn runs on the account's default
     * (the backend then records that choice on the node).
     */
    backendAgentId: z.string().min(1).nullable().default(null),
    /**
     * When the learner last did anything in the node — opened it or recorded a
     * message in any of its threads. Orders the session history. Optional on
     * the wire so a snapshot from before activity tracking still parses; it
     * then falls back to `lastOpenedAt`, the closest thing that snapshot knew.
     */
    lastActivityAt: z.string().datetime({ offset: true }).optional(),
    /**
     * Defaulted to `topic` for the same reason: every node created before
     * automatic titling was created with an explicit title.
     */
    titleSource: TitleSourceSchema.default('topic'),
    /**
     * The learner's choices for this session's agent (agent-session-controls),
     * and what its last turn actually ran with. Optional — and lenient — so a
     * snapshot from before session controls, or a malformed entry, still
     * parses; either one absent reads as `null`.
     */
    agentSettings: AgentSettingsSchema.nullish().catch(null),
    agentState: AgentStateSchema.nullish().catch(null),
    /**
     * The one project this session belongs to (node-projects-and-archive).
     * Defaulted to `null` so a snapshot from a backend that predates projects
     * still parses; `null` then reads as "no project is known", and nothing
     * in the interface groups or labels the node.
     */
    projectId: z.string().min(1).nullable().default(null),
  })
  .transform((node) => ({ ...node, lastActivityAt: node.lastActivityAt ?? node.lastOpenedAt }))

export type WorkspaceNode = z.infer<typeof WorkspaceNodeSchema>

/**
 * A parent→child edge in the session graph, carrying the anchor the child was
 * branched from.
 *
 * Edges are modelled explicitly rather than as a `parentId` field on the node
 * because the fixture graph has a shared child with two parents, and a single
 * field cannot express that. This is a UI-layer representation only — whether
 * `Link` or `Node.parent_id` becomes the backend's source of truth is still
 * open and belongs to the Phase 2 change (design.md "Open Questions").
 */
export const NodeLinkSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1),
  childId: z.string().min(1),
  anchor: SelectionAnchorSchema.nullable(),
})

export type NodeLink = z.infer<typeof NodeLinkSchema>

/**
 * A named group of sessions. Membership is one project per node; a link may
 * join nodes of different projects, so a project is a label and a source of
 * instructions, never a container the graph has to respect.
 */
export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  instructions: z.string().default(''),
  /** Where sessions with no chosen project go. It cannot be archived or deleted. */
  isDefault: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
})

export type Project = z.infer<typeof ProjectSchema>

/**
 * A link whose other end is archived: the unarchived end (`nodeId`) is told
 * that such a link exists, and who is on the other side, so the canvas can say
 * so and offer to bring that session back instead of dropping the link silently.
 */
export const ArchivedLinkSchema = z.object({
  nodeId: z.string().min(1),
  archivedNodeId: z.string().min(1),
  archivedTitle: z.string(),
})

export type ArchivedLink = z.infer<typeof ArchivedLinkSchema>

/**
 * Everything the workspace renders, in one validated envelope. `projects` and
 * `archivedLinks` default to empty so a snapshot from before projects parses.
 */
export const WorkspaceGraphSchema = z.object({
  nodes: z.array(WorkspaceNodeSchema),
  links: z.array(NodeLinkSchema),
  threads: z.array(ChatThreadSchema),
  messages: z.array(ChatMessageSchema),
  projects: z.array(ProjectSchema).default([]),
  archivedLinks: z.array(ArchivedLinkSchema).default([]),
})

export type WorkspaceGraph = z.infer<typeof WorkspaceGraphSchema>

/** A thread with no anchor is the node's `main` thread. */
export function isMainThread(thread: ChatThread): boolean {
  return thread.anchor === null
}
