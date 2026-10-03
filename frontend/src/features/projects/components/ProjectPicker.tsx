import { useId } from 'react'

import type { Project } from '../../../shared/lib/workspace-types'

export type ProjectPickerProps = {
  projects: readonly Project[]
  value: string | null
  onChange: (projectId: string) => void
}

/**
 * Which project a new session starts in. Takes the unarchived projects the
 * snapshot carries, so an archived one is never offered; renders nothing when
 * the backend has reported none.
 */
function ProjectPicker({ projects, value, onChange }: ProjectPickerProps) {
  const id = useId()
  if (projects.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-gray-600">
        Project
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export default ProjectPicker
