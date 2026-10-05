import { create } from 'zustand'

/** Whether the Settings dialog is open. Its sections keep their own state. */
type SettingsPanelState = {
  panelOpen: boolean
  openPanel: () => void
  closePanel: () => void
}

export const useSettingsPanelStore = create<SettingsPanelState>((set) => ({
  panelOpen: false,
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
}))
