import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { useAccountStore, type Profile } from '../account-store'

import SignInSurface from './SignInSurface'

const PROFILE: Profile = {
  id: 'p-1',
  provider: 'local',
  subject: 'subject-alice',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
}

const ENROLLED: Profile = {
  id: 'p-old',
  provider: 'dev',
  subject: 'subject-ada',
  email: null,
  displayName: 'Ada',
  avatarUrl: null,
}

const UNNAMED: Profile = {
  id: 'p-blank',
  provider: 'local',
  subject: 'ff01ab99cc',
  email: null,
  displayName: null,
  avatarUrl: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Signed out, with the backend reporting the given mechanisms. */
function session(mechanisms: string[]): void {
  useAccountStore.getState().applySession({ profile: null, mechanisms })
}

/**
 * Routes `fetch` by path so a test can state the profile list and the sign-in
 * result independently. Returns the mock so a test can assert which endpoint
 * was called — the difference between creating an account and returning to one
 * is exactly which path was hit.
 */
function stubFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    void init
    const match = Object.keys(routes).find((route) => path.endsWith(route))
    if (match === undefined) return Promise.resolve(jsonResponse({ detail: 'Not Found' }, 404))
    return Promise.resolve(routes[match]!())
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  useAccountStore.getState().reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SignInSurface', () => {
  it('renders while no account is active', async () => {
    session(['local'])
    stubFetch({ '/auth/profiles': () => jsonResponse([]) })
    render(<SignInSurface />)

    expect(screen.getByTestId('sign-in-surface')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    // Awaited so the profile fetch settles inside the test rather than after
    // it, which is what React reports as an update outside `act`.
    await screen.findByRole('button', { name: /create a profile/i })
  })

  it('always offers a way in when the backend reports only the local mechanism', async () => {
    // The dead end this change exists to remove: with the development gate
    // shut, the surface must still present a completable action.
    session(['local'])
    stubFetch({ '/auth/profiles': () => jsonResponse([]) })
    render(<SignInSurface />)

    expect(await screen.findByRole('button', { name: /create a profile/i })).toBeEnabled()
    expect(screen.queryByTestId('sign-in-unreachable')).toBeNull()
  })

  it('renders no picker on a device with no enrolled accounts', async () => {
    session(['local'])
    stubFetch({ '/auth/profiles': () => jsonResponse([]) })
    render(<SignInSurface />)

    await screen.findByRole('button', { name: /create a profile/i })
    // Absent rather than an empty list with an error: a first launch is the
    // expected state, not a failure to enumerate.
    expect(screen.queryByTestId('profile-picker')).toBeNull()
  })

  it('lists the accounts enrolled on this device', async () => {
    session(['local'])
    stubFetch({ '/auth/profiles': () => jsonResponse([ENROLLED, PROFILE]) })
    render(<SignInSurface />)

    expect(await screen.findByTestId('profile-picker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ada/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Alice/ })).toBeInTheDocument()
  })

  it('lists an account whose mechanism this backend no longer offers', async () => {
    // `ENROLLED` is a `dev` account and the reported mechanisms are local-only.
    // Filtering the picker by what is registered would strand it — the same
    // dead end one layer down.
    session(['local'])
    stubFetch({ '/auth/profiles': () => jsonResponse([ENROLLED]) })
    render(<SignInSurface />)

    const entry = await screen.findByRole('button', { name: /Ada/ })
    expect(entry).toBeEnabled()
    expect(entry).toHaveTextContent('dev')
  })

  it('distinguishes two accounts that have no display name', async () => {
    const other = { ...UNNAMED, id: 'p-blank-2', subject: '0099zzab11' }
    session(['local'])
    stubFetch({ '/auth/profiles': () => jsonResponse([UNNAMED, other]) })
    render(<SignInSurface />)

    await screen.findByTestId('profile-picker')
    const labels = screen
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
      .filter((text) => text.includes('Unnamed profile'))

    expect(labels).toHaveLength(2)
    expect(labels[0]).not.toEqual(labels[1])
  })

  it('activates a selected account rather than enrolling a second one', async () => {
    session(['local'])
    const fetchMock = stubFetch({
      '/auth/profiles': () => jsonResponse([ENROLLED]),
      [`/auth/profiles/${ENROLLED.id}/activate`]: () => jsonResponse(ENROLLED),
    })
    render(<SignInSurface />)

    fireEvent.click(await screen.findByRole('button', { name: /Ada/ }))

    await waitFor(() => expect(useAccountStore.getState().activeProfile).toEqual(ENROLLED))
    const paths = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(paths).toContain(`/api/auth/profiles/${ENROLLED.id}/activate`)
    expect(paths.some((path) => path.includes('signin'))).toBe(false)
  })

  it('creates a profile through the local mechanism', async () => {
    session(['local'])
    const fetchMock = stubFetch({
      '/auth/profiles': () => jsonResponse([]),
      '/auth/local/signin': () => jsonResponse(PROFILE),
    })
    render(<SignInSurface />)

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: /create a profile/i }))

    await waitFor(() => expect(useAccountStore.getState().activeProfile).toEqual(PROFILE))
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain(
      '/api/auth/local/signin',
    )
  })

  it('creates a profile with no display name supplied', async () => {
    session(['local'])
    const fetchMock = stubFetch({
      '/auth/profiles': () => jsonResponse([]),
      '/auth/local/signin': () => jsonResponse({ ...PROFILE, displayName: null }),
    })
    render(<SignInSurface />)

    fireEvent.click(screen.getByRole('button', { name: /create a profile/i }))

    await waitFor(() => expect(useAccountStore.getState().activeProfile).not.toBeNull())
    const body = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('local/signin'),
    )?.[1] as RequestInit | undefined
    expect(body?.body).toBe('{}')
  })

  it('offers development sign-in when the backend reports the gate open', async () => {
    session(['local', 'dev'])
    stubFetch({ '/auth/profiles': () => jsonResponse([]) })
    render(<SignInSurface />)

    expect(
      await screen.findByRole('button', { name: /development sign-in/i }),
    ).toBeInTheDocument()
  })

  it('offers no development sign-in when the gate is closed', async () => {
    session(['local'])
    stubFetch({ '/auth/profiles': () => jsonResponse([]) })
    render(<SignInSurface />)

    await screen.findByRole('button', { name: /create a profile/i })
    // Absent, not disabled: an unregistered mechanism must look like a control
    // that was never built, matching the backend's 404.
    expect(screen.queryByRole('button', { name: /development sign-in/i })).toBeNull()
  })

  it('carries the typed name into development sign-in as well', async () => {
    // The E2E suite signs in by typing a name and clicking this control, and
    // the development adapter derives its subject from that name — dropping it
    // would make every E2E sign-in the same anonymous account.
    session(['local', 'dev'])
    const fetchMock = stubFetch({
      '/auth/profiles': () => jsonResponse([]),
      '/auth/dev/signin': () => jsonResponse({ ...PROFILE, provider: 'dev' }),
    })
    render(<SignInSurface />)

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Ada' } })
    fireEvent.click(await screen.findByRole('button', { name: /development sign-in/i }))

    await waitFor(() => expect(useAccountStore.getState().activeProfile).not.toBeNull())
    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('dev/signin'))
    expect((call?.[1] as RequestInit | undefined)?.body).toBe('{"displayName":"Ada"}')
  })

  it('reports an unreachable backend as such, not as a missing sign-in method', async () => {
    // An empty mechanism list can only mean the session read failed: a
    // reachable backend always registers the local mechanism.
    session([])
    stubFetch({ '/auth/profiles': () => jsonResponse([]) })
    render(<SignInSurface />)

    expect(screen.getByTestId('sign-in-unreachable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create a profile/i })).toBeNull()
  })

  it('reports a recoverable failure and stays signed out when sign-in fails', async () => {
    session(['local'])
    stubFetch({
      '/auth/profiles': () => jsonResponse([]),
      '/auth/local/signin': () => jsonResponse({ detail: 'boom' }, 500),
    })
    render(<SignInSurface />)

    fireEvent.click(screen.getByRole('button', { name: /create a profile/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i)
    expect(useAccountStore.getState().activeProfile).toBeNull()
    // Recoverable means the control is still there to press again.
    expect(screen.getByRole('button', { name: /create a profile/i })).toBeEnabled()
  })

  it('explains a mechanism that turns out to be unregistered at request time', async () => {
    session(['local', 'dev'])
    stubFetch({
      '/auth/profiles': () => jsonResponse([]),
      '/auth/dev/signin': () => jsonResponse({ detail: 'Not Found' }, 404),
    })
    render(<SignInSurface />)

    fireEvent.click(await screen.findByRole('button', { name: /development sign-in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not available/i)
    expect(useAccountStore.getState().activeProfile).toBeNull()
  })

  it('keeps the surface usable when the profile list cannot be read', async () => {
    session(['local'])
    stubFetch({ '/auth/profiles': () => jsonResponse({ detail: 'boom' }, 500) })
    render(<SignInSurface />)

    // Failing to enumerate accounts must not remove the way to create one.
    expect(await screen.findByRole('button', { name: /create a profile/i })).toBeEnabled()
  })
})
