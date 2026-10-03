/**
 * What a block body shows: the block's items (`itemIds`), and — only in the
 * learner's own block — the way to write another. Without `itemIds`, every
 * item of the kind on the node.
 */
export type BlockBodyProps = {
  nodeId: string
  itemIds?: string[]
  canAuthor?: boolean
  /** The block was opened to write into: the form starts open. */
  startAuthoring?: boolean
}
