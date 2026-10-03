import { describe, expect, it } from 'vitest'

import type { Project } from '../../shared/lib/workspace-types'

import { filterByProject, preselectedProject } from './filter-sessions'

const project = (id: string, isDefault = false): Project => ({
  id,
  name: id,
  instructions: '',
  isDefault,
  createdAt: '2026-09-01T00:00:00.000Z',
})

describe('filterByProject', () => {
  const sessions = [
    { id: 'a', projectId: 'p1' },
    { id: 'b', projectId: 'p2' },
    { id: 'c', projectId: null },
  ]

  it('lists every session with no filter', () => {
    expect(filterByProject(sessions, null)).toEqual(sessions)
  })

  it('lists only the members of the filtered project', () => {
    expect(filterByProject(sessions, 'p1').map((s) => s.id)).toEqual(['a'])
  })

  it('lists nothing for a project with no members', () => {
    expect(filterByProject(sessions, 'p3')).toEqual([])
  })
})

describe('preselectedProject', () => {
  const projects = [project('general', true), project('algebra')]

  it('prefers the filtered project, then the default one', () => {
    expect(preselectedProject(projects, 'algebra')).toBe('algebra')
    expect(preselectedProject(projects, null)).toBe('general')
  })

  it('ignores a filter naming a project that is not there', () => {
    expect(preselectedProject(projects, 'gone')).toBe('general')
  })

  it('offers nothing when the backend reports no projects', () => {
    expect(preselectedProject([], null)).toBeNull()
  })
})
