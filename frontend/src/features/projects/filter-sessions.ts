import type { Project } from '../../shared/lib/workspace-types'

/**
 * The sessions of one project, or all of them with no filter. Membership is
 * the whole test: a session linked to a project's sessions but belonging to
 * another project is not in it.
 */
export function filterByProject<T extends { projectId: string | null }>(
  sessions: readonly T[],
  projectId: string | null,
): T[] {
  return projectId === null ? [...sessions] : sessions.filter((session) => session.projectId === projectId)
}

/**
 * The project a start dialog offers first: the one the history is filtered to,
 * else the default project, else none (a backend that has no projects).
 */
export function preselectedProject(projects: readonly Project[], filter: string | null): string | null {
  if (filter !== null && projects.some((project) => project.id === filter)) return filter
  return projects.find((project) => project.isDefault)?.id ?? projects[0]?.id ?? null
}

/** Why the default project has no archive or delete control. */
export const DEFAULT_PROJECT_REASON =
  'This is the default project: it is where sessions without a project go, so it cannot be archived or deleted. You can rename it.'
