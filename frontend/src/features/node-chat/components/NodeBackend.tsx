import { useEffect, useId, useState } from 'react'

import { selectDefaultAgent, useAgentsStore } from '../../settings'
import { useWorkspaceStore } from '../../../shared/lib/workspace-store'
import type { WorkspaceNode } from '../../../shared/lib/workspace-types'

/**
 * Which agent the node's conversation runs on, and what that costs.
 *
 * A node-level setting shown in the node header: every thread on the node
 * runs on it, so no thread offers its own. Changing it is a deliberate second
 * step behind "Change agent" rather than an always-visible control, because it
 * moves every thread on the node.
 *
 * The note about compaction and skill merging is the whole of their presence
 * on an agent backend: there is deliberately no control that approximates
 * them (see design.md "Compaction is unavailable on agent backends").
 */
function NodeBackend({ node }: { node: WorkspaceNode }) {
  const agents = useAgentsStore((s) => s.agents)
  const status = useAgentsStore((s) => s.status)
  const load = useAgentsStore((s) => s.load)
  const openPanel = useAgentsStore((s) => s.openPanel)
  const defaultAgent = useAgentsStore(selectDefaultAgent)
  const setNodeBackend = useWorkspaceStore((s) => s.setNodeBackend)
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectId = useId()

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])

  let label: string
  if (node.backendAgentId !== null) {
    const agent = agents.find((candidate) => candidate.id === node.backendAgentId)
    label = agent ? agent.name : status === 'ready' ? 'an agent that is no longer registered' : '…'
  } else if (defaultAgent) {
    label = `default: ${defaultAgent.name}`
  } else {
    label = status === 'ready' ? 'none registered' : '…'
  }

  async function choose(agentId: string): Promise<void> {
    setError(null)
    try {
      await setNodeBackend(node.id, agentId)
      setChoosing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <div data-testid="node-backend" className="mt-1 text-xs text-gray-500">
      <p className="flex flex-wrap items-center gap-2">
        <span>
          Agent: <span data-testid="node-backend-name" className="font-medium text-gray-700">{label}</span>
        </span>
        {agents.length > 0 && !choosing ? (
          <button
            type="button"
            onClick={() => setChoosing(true)}
            className="text-blue-700 underline hover:text-blue-900"
          >
            Change agent
          </button>
        ) : null}
        {status === 'ready' && agents.length === 0 ? (
          <button type="button" onClick={openPanel} className="text-blue-700 underline hover:text-blue-900">
            Set up an agent
          </button>
        ) : null}
      </p>
      {choosing ? (
        <div className="mt-1 flex items-center gap-2">
          <label htmlFor={selectId}>Run this node on</label>
          <select
            id={selectId}
            value={node.backendAgentId ?? ''}
            onChange={(event) => {
              if (event.target.value) void choose(event.target.value)
            }}
            className="rounded border border-gray-300 px-1 py-0.5 text-xs"
          >
            {node.backendAgentId === null ? <option value="">{label}</option> : null}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setChoosing(false)} className="text-gray-600 underline">
            Cancel
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-red-700">
          Could not change the agent: {error}
        </p>
      ) : null}
      <p data-testid="agent-backend-limits" className="mt-1 text-gray-500">
        Compaction and skill merging are unavailable on agent backends: the agent manages its own
        context, so Learn Nodes cannot assemble or compact it.
      </p>
    </div>
  )
}

export default NodeBackend
