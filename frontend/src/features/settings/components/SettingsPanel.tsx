import { useEffect, useId } from 'react'

import { useSettingsPanelStore } from '../settings-panel-store'
import DataLocationSection from './DataLocationSection'

/**
 * The application's own settings — where its data lives. Agents and memory
 * keep their own panels; this one is for the application itself.
 */
function SettingsPanel() {
  const panelOpen = useSettingsPanelStore((s) => s.panelOpen)
  const closePanel = useSettingsPanelStore((s) => s.closePanel)
  const headingId = useId()

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, closePanel])

  if (!panelOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl"
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 id={headingId} className="text-base font-semibold text-gray-900">
            Settings
          </h2>
          <button
            type="button"
            onClick={closePanel}
            className="rounded px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </header>

        <DataLocationSection />
      </div>
    </div>
  )
}

export default SettingsPanel
