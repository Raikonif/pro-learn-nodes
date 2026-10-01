import { SandboxTool } from '../sandbox'
import { usePracticeStore } from '../practice-store'

import { ToolLoading, ToolUnavailable, buttonSecondary } from './ToolStates'

/**
 * Gives the sandbox the open node's buffer and takes its edits.
 *
 * The buffer lives in the practice store, not in the sandbox: the store writes
 * it to the backend on a debounce and flushes it when the node is left. A
 * run's output stays inside `SandboxTool`, which is re-keyed per node — so
 * returning to a node restores its code and never a previous run's result.
 */
function SandboxPanel({ nodeId }: { nodeId: string }) {
  const code = usePracticeStore((s) => s.buffers[nodeId])
  const material = usePracticeStore((s) => s.material[nodeId])
  const saveStatus = usePracticeStore((s) => s.sandboxSave[nodeId])
  const editSandbox = usePracticeStore((s) => s.editSandbox)
  const flushSandbox = usePracticeStore((s) => s.flushSandbox)
  const load = usePracticeStore((s) => s.load)

  if (code === undefined) {
    // Never an empty buffer standing in for code that failed to load: typing
    // into it would overwrite the node's saved code.
    if (material?.status === 'failed') {
      return (
        <ToolUnavailable
          what="This node's saved code could not be loaded."
          reason={material.reason}
          onRetry={() => void load(nodeId)}
        />
      )
    }
    return <ToolLoading>Loading this node's code…</ToolLoading>
  }

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <SandboxTool key={nodeId} nodeId={nodeId} code={code} onCodeChange={(next: string) => editSandbox(nodeId, next)} />
      {saveStatus === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <p className="text-red-700">Your code could not be saved.</p>
          <button type="button" onClick={() => void flushSandbox(nodeId)} className={buttonSecondary}>
            Retry saving
          </button>
        </div>
      )}
    </div>
  )
}

export default SandboxPanel
