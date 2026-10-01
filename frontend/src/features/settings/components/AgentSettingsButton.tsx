import { useAgentsStore } from '../agents-store'

/** Opens agent settings from the workspace header, beside the account. */
function AgentSettingsButton() {
  const openPanel = useAgentsStore((s) => s.openPanel)

  return (
    <button
      type="button"
      onClick={openPanel}
      aria-label="Agent settings"
      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
    >
      Agents
    </button>
  )
}

export default AgentSettingsButton
