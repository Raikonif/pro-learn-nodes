import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { useAccountStore, type Profile } from '../account-store'

import AccountAffordance from './AccountAffordance'

const NAMED: Profile = {
  id: 'p-1',
  provider: 'dev',
  subject: 'subject-alice',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
}

function signedInAs(profile: Profile): void {
  useAccountStore.getState().applySession({ profile, mechanisms: ['local', 'dev'] })
}

beforeEach(() => {
  useAccountStore.getState().reset()
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AccountAffordance', () => {
  it('shows the active display name', () => {
    signedInAs(NAMED)
    render(<AccountAffordance />)

    expect(screen.getByTestId('account-identity')).toHaveTextContent('Alice')
  })

  it('falls back to the email address when the provider supplied no display name', () => {
    signedInAs({ ...NAMED, displayName: null })
    render(<AccountAffordance />)

    expect(screen.getByTestId('account-identity')).toHaveTextContent('alice@example.com')
  })

  it('names the provider when neither display name nor email exists', () => {
    signedInAs({ ...NAMED, displayName: null, email: null })
    render(<AccountAffordance />)

    // Never an empty element: an unlabelled account is still identifiable by
    // where it came from.
    expect(screen.getByTestId('account-identity')).toHaveTextContent('dev account')
  })

  it('renders nothing while no account is active', () => {
    render(<AccountAffordance />)

    expect(screen.queryByTestId('account-identity')).toBeNull()
  })

  it('clears the active account when signing out', async () => {
    signedInAs(NAMED)
    render(<AccountAffordance />)

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(useAccountStore.getState().activeProfile).toBeNull())
  })

  it('signs out locally even when the server call fails', async () => {
    signedInAs(NAMED)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )
    render(<AccountAffordance />)

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(useAccountStore.getState().activeProfile).toBeNull())
  })
})
