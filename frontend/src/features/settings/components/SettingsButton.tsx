import { useSettingsPanelStore } from '../settings-panel-store'

/** Opens the application's settings from the workspace header. */
function SettingsButton() {
  const openPanel = useSettingsPanelStore((s) => s.openPanel)

  return (
    <button
      type="button"
      onClick={openPanel}
      aria-label="Settings"
      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
    >
      Settings
    </button>
  )
}

export default SettingsButton
