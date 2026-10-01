import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { ApiHttpError } from '../../../shared/lib/api-client'
import { activateProfile, devSignIn, fetchProfiles, localSignIn } from '../account-api'
import {
  selectBackendReachable,
  selectDevSignInAvailable,
  useAccountStore,
  type Profile,
} from '../account-store'

function messageFor(error: unknown): string {
  // A 404 is a mechanism this backend does not offer, not a broken request:
  // an unregistered endpoint is built to be indistinguishable from one that
  // was never deployed, so the learner is told what is true rather than
  // invited to retry something that cannot work.
  if (error instanceof ApiHttpError && error.status === 404) {
    return 'That sign-in method is not available on this device.'
  }
  return 'Sign-in failed. Please try again.'
}

/**
 * How an account with no display name is told apart from another one.
 *
 * The subject rather than a position in the list: a number would shift when an
 * earlier account is removed, so the same learner would come back to a
 * different label. The subject is opaque and carries nothing the learner
 * typed — the local mechanism mints it at random precisely so it does not.
 */
function labelFor(profile: Profile): string {
  return profile.displayName ?? `Unnamed profile · ${profile.subject.slice(0, 6)}`
}

/**
 * The root view while no account is active.
 *
 * A picker over the accounts already on this device, plus a way to create
 * another. The picker comes first because returning is the common case and
 * creating is the one-time one — and because an account is reached by
 * selecting it, which is what lets the local mechanism mint a fresh subject
 * per creation instead of deriving one that could collide.
 *
 * Development sign-in appears beside them when the backend reports it, rather
 * than being the surface itself. Any mechanism this build has no control for
 * is simply not rendered; it is not an error.
 */
function SignInSurface() {
  const devSignInAvailable = useAccountStore(selectDevSignInAvailable)
  const backendReachable = useAccountStore(selectBackendReachable)
  const setActiveProfile = useAccountStore((state) => state.setActiveProfile)
  const loadSession = useAccountStore((state) => state.loadSession)

  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Held here rather than in the account store: the store's subject is which
  // account is *active*, and this list is only ever needed by this one screen.
  // Putting it in the store would make every consumer of the store re-render
  // on a fetch that concerns none of them.
  useEffect(() => {
    // Skipped while the backend is unreachable: that branch renders no picker,
    // so the request could only fail and land its result on a screen nothing
    // reads it from.
    if (!backendReachable) return
    let cancelled = false
    void fetchProfiles()
      // An unreachable backend is already reported by `backendReachable`; an
      // empty list here means the same thing as no accounts, and both render
      // the create form, so there is nothing more to say.
      .then((listed) => !cancelled && setProfiles(listed))
      .catch(() => !cancelled && setProfiles([]))
    return () => {
      cancelled = true
    }
  }, [backendReachable])

  const attempt = useCallback(
    async (signIn: () => Promise<Profile>): Promise<void> => {
      setPending(true)
      setError(null)
      try {
        // No `setPending(false)` on success: the account becomes active, which
        // replaces this surface with the workspace.
        setActiveProfile(await signIn())
      } catch (failure) {
        setError(messageFor(failure))
        setPending(false)
      }
    },
    [setActiveProfile],
  )

  /**
   * The typed name, in the shape a sign-in request takes, or an empty request.
   *
   * Shared by both mechanisms rather than belonging to the create form: it is
   * the name the learner wants either way, and each adapter uses it on its own
   * terms. The local one keeps it as a display field only, having already
   * minted a subject at random; the development one derives its subject from
   * it, which is what makes a development sign-in repeatable and is why the
   * E2E suite can sign in as the same account twice.
   */
  function requested(): { displayName?: string } {
    const trimmed = displayName.trim()
    return trimmed ? { displayName: trimmed } : {}
  }

  function handleCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void attempt(() => localSignIn(requested()))
  }

  if (!backendReachable) {
    // Distinct from having no mechanism: a reachable backend always offers
    // one, so an empty list means the session read failed. Saying "no sign-in
    // method is available" here would send the learner looking for a setting
    // to change when the backend is simply not running.
    return (
      <div
        data-testid="sign-in-surface"
        className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-gray-900"
      >
        <p data-testid="sign-in-unreachable" className="max-w-xs text-center text-sm text-gray-600">
          Learn Nodes cannot reach its local backend. Start it and try again.
        </p>
        <button
          type="button"
          onClick={() => void loadSession()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid="sign-in-surface"
      className="flex h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-6 text-gray-900"
    >
      <div className="text-center">
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-gray-600">
          Learn Nodes keeps each account&rsquo;s graph separate on this device.
        </p>
      </div>

      {profiles !== null && profiles.length > 0 && (
        <ul data-testid="profile-picker" className="flex w-full max-w-xs flex-col gap-2">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => void attempt(() => activateProfile(profile.id))}
                className="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm hover:border-gray-400 disabled:opacity-60"
              >
                <span className="font-medium">{labelFor(profile)}</span>
                {/* The originating mechanism is shown so a development account
                    stays distinguishable from an ordinary one, which the
                    identity spec requires and no privilege difference marks. */}
                <span className="text-xs text-gray-500">{profile.provider}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} className="flex w-full max-w-xs flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Display name (optional)
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Alice"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-normal"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? 'Working…' : 'Create a profile'}
        </button>
      </form>

      {devSignInAvailable && (
        <button
          type="button"
          disabled={pending}
          onClick={() => void attempt(() => devSignIn(requested()))}
          className="text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-60"
        >
          Continue with development sign-in
        </button>
      )}

      {error !== null && (
        <p role="alert" className="max-w-xs text-center text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

export default SignInSurface
