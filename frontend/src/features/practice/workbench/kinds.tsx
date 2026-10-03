import type { ComponentType } from 'react'

import CodeTool from '../components/CodeTool'
import QuestionsTool from '../components/QuestionsTool'
import QuizTool from '../components/QuizTool'

import { MINE_QA_KEY, MINE_QUIZ_KEY, SCRATCH_KEY, type Block, type BlockKey, type BlockKind } from './blocks'

export type BlockBody = ComponentType<{ nodeId: string; block: Block; startAuthoring: boolean }>

/**
 * One kind of work the workbench can hold.
 *
 * The workbench only iterates blocks and looks their kind up here; a new kind
 * — a diagram, flashcards — is a new entry, and touches neither the surface
 * nor the other kinds (design.md "The block-kind registry").
 */
export type BlockKindSpec = {
  label: string
  Body: BlockBody
  /** What the add control offers for this kind; absent when it offers nothing. */
  add?: {
    /** Writing it oneself: the block opened, its form open when `author`. */
    write: { label: string; block: BlockKey; author: boolean }
    /** Asking the agent: the command placed in the composer. */
    ask: { label: string; command: string }
  }
}

export const BLOCK_KINDS: Record<BlockKind, BlockKindSpec> = {
  quiz: {
    label: 'Quiz',
    Body: ({ nodeId, block, startAuthoring }) => (
      <QuizTool
        nodeId={nodeId}
        itemIds={block.itemIds}
        canAuthor={block.key === MINE_QUIZ_KEY}
        startAuthoring={startAuthoring}
      />
    ),
    add: {
      write: { label: 'Write a quiz question', block: MINE_QUIZ_KEY, author: true },
      ask: { label: 'Ask the agent for a quiz', command: '/quiz ' },
    },
  },
  qa: {
    label: 'Q&A',
    Body: ({ nodeId, block, startAuthoring }) => (
      <QuestionsTool
        nodeId={nodeId}
        itemIds={block.itemIds}
        canAuthor={block.key === MINE_QA_KEY}
        startAuthoring={startAuthoring}
      />
    ),
    add: {
      write: { label: 'Write a question', block: MINE_QA_KEY, author: true },
      ask: { label: 'Ask the agent for questions', command: '/qa ' },
    },
  },
  code: {
    label: 'Code',
    Body: ({ nodeId, block }) => <CodeTool nodeId={nodeId} itemId={block.itemIds[0] ?? null} />,
    add: {
      write: { label: 'Open scratch code', block: SCRATCH_KEY, author: false },
      ask: { label: 'Ask the agent for an exercise', command: '/code ' },
    },
  },
  scratch: {
    label: 'Scratch',
    Body: ({ nodeId }) => <CodeTool nodeId={nodeId} itemId={null} />,
  },
}

/** The add control's entries, in the order they are offered. */
export const ADDABLE_KINDS: BlockKind[] = ['code', 'quiz', 'qa']
