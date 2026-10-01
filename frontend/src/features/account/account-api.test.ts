import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiHttpError } from '../../shared/lib/api-client'

import { devSignIn, fetchSession, signOut } from './account-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const PROFILE = {
  id: 'p-1',
  provider: 'dev',
  subject: 'subject-alice',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
}

describe('account api', () => {
  it('reads the session from the proxied /api path', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ profile: null, mechanisms: ['local', 'dev'] })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const session = await fetchSession()

    expect(session).toEqual({ profile: null, mechanisms: ['local', 'dev'] })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', { method: 'GET' })
  })

  it('carries the active profile when one is signed in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ profile: PROFILE, mechanisms: ['local'] }))),
    )

    const session = await fetchSession()

    expect(session.profile).toEqual(PROFILE)
  })

  it('posts only the fields the learner supplied to development sign-in', async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(PROFILE)),
    )
    vi.stubGlobal('fetch', fetchMock)

    const profile = await devSignIn({ displayName: 'Alice' })

    expect(profile).toEqual(PROFILE)
    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe('/api/auth/dev/signin')
    expect(call?.[1]?.body).toBe(JSON.stringify({ displayName: 'Alice' }))
  })

  it('surfaces the closed gate as a 404, not a special-cased success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ detail: 'Not Found' }, 404))),
    )

    const error = await devSignIn().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiHttpError)
    expect((error as ApiHttpError).status).toBe(404)
  })

  it('resolves sign-out even when the server sends no parseable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    )

    await expect(signOut()).resolves.toBeUndefined()
  })
})
