// Public surface for the projects feature.
// Import this feature only via this file; internal paths are private.
export { default as ProjectsPanel } from './components/ProjectsPanel'
export { default as ProjectDialogHost } from './components/ProjectDialogHost'
export { default as MoveToProject } from './components/MoveToProject'
export { default as ProjectPicker } from './components/ProjectPicker'
export { default as ProjectChip } from './components/ProjectChip'
export { default as SessionProject } from './components/SessionProject'
export { DEFAULT_PROJECT_REASON, filterByProject, preselectedProject } from './filter-sessions'
export {
  openDeleteProject,
  openNewProject,
  openProjectInstructions,
  openRenameProject,
  useProjectsUi,
} from './projects-ui-store'
export type { ProjectDialog } from './projects-ui-store'
export type { MoveToProjectProps } from './components/MoveToProject'
export type { ProjectPickerProps } from './components/ProjectPicker'
