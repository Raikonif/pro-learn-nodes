import { create } from 'zustand'

/**
 * Which project dialog is showing, if any. Held in a store, not in the control
 * that asks for it, for the reason the detailed start is: the rail's menu, the
 * session header and the command palette all open the same dialogs, and the
 * workspace mounts one host for them (`ProjectDialogHost`) so none of them is
 * rendered twice and none of them adds a pane.
 */
export type ProjectDialog =
  | { kind: 'new' }
  | { kind: 'rename'; projectId: string }
  | { kind: 'instructions'; projectId: string }
  | { kind: 'delete'; projectId: string }

type ProjectsUiState = {
  dialog: ProjectDialog | null
  open: (dialog: ProjectDialog) => void
  close: () => void
}

export const useProjectsUi = create<ProjectsUiState>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}))

export function openNewProject(): void {
  useProjectsUi.getState().open({ kind: 'new' })
}

export function openRenameProject(projectId: string): void {
  useProjectsUi.getState().open({ kind: 'rename', projectId })
}

/** Shows the project's instructions, where they can be edited. */
export function openProjectInstructions(projectId: string): void {
  useProjectsUi.getState().open({ kind: 'instructions', projectId })
}

export function openDeleteProject(projectId: string): void {
  useProjectsUi.getState().open({ kind: 'delete', projectId })
}
