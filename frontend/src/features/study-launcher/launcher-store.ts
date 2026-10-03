import { create } from 'zustand'

/**
 * Whether the detailed start dialog is showing. Held in a store, not in the
 * button, so something outside it — the command palette — can open the one
 * dialog instead of growing a second.
 */
type LauncherState = {
  detailedOpen: boolean
  /**
   * Whether a `DetailedStartHost` is mounted. The button shows the dialog
   * itself only when none is, so one dialog ever renders however it was opened.
   */
  hosted: boolean
  setHosted: (hosted: boolean) => void
  openDetailed: () => void
  closeDetailed: () => void
}

export const useLauncher = create<LauncherState>((set) => ({
  detailedOpen: false,
  hosted: false,
  setHosted: (hosted) => set({ hosted }),
  openDetailed: () => set({ detailedOpen: true }),
  closeDetailed: () => set({ detailedOpen: false }),
}))

/** Opens the "Start a session" dialog, as its button does. */
export function openDetailedStart(): void {
  useLauncher.getState().openDetailed()
}
