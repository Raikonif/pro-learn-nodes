import { z } from 'zod'

import apiClient, { ApiValidationError } from '../../shared/lib/api-client'

import type { Profile } from './account-store'

/**
 * Wire shape of an enrolled account.
 *
 * Typed as `z.ZodType<Profile>` rather than left to inference so the store's
 * `Profile` stays the single definition of the shape: if the wire contract and
 * the domain type ever drift apart, this line stops compiling.
 */
const ProfileSchema: z.ZodType<Profile> = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
})

/** The mechanism that is always registered, and the reason a build is enterable. */
export const LOCAL_MECHANISM = 'local'
/** Registered only when the launch-time development gate is open. */
export const DEV_MECHANISM = 'dev'

/**
 * What `GET /auth/session` reports.
 *
 * `mechanisms` comes from the server because which ones exist is decided when
 * the backend is constructed: the client has no way to tell a registered
 * mechanism from an absent one short of calling each endpoint and reading the
 * 404, which would mean offering controls that may lead nowhere.
 *
 * A list rather than a flag per mechanism — a boolean each would mean editing
 * this schema, the store, and the surface every time an adapter is added.
 * Unknown names are kept rather than rejected: a backend offering a mechanism
 * this build has no UI for should not fail validation and blank the screen.
 */
export const SessionSchema = z.object({
  profile: ProfileSchema.nullable(),
  mechanisms: z.array(z.string()),
})

export type Session = z.infer<typeof SessionSchema>

export type SignInRequest = {
  displayName?: string
  email?: string
}

/**
 * Reads the session. Never answers 401 — this is the route that *reports*
 * signed-out state, so a rejection here means the backend is unreachable.
 */
export function fetchSession(): Promise<Session> {
  return apiClient.get('/auth/session', { schema: SessionSchema })
}

/**
 * Enrolls and activates a development account. Rejects with an `ApiHttpError`
 * of status 404 when the gate is closed, which is deliberately the same answer
 * an unknown route gives.
 */
export function devSignIn(request: SignInRequest = {}): Promise<Profile> {
  return apiClient.post('/auth/dev/signin', request, { schema: ProfileSchema })
}

/**
 * Creates and activates a local account.
 *
 * Every call enrolls a *new* account, which is the deliberate difference from
 * `devSignIn`: the backend mints a fresh subject per request so that two
 * learners who both type "Alice" get two graphs. Returning to an existing
 * account is `activateProfile`, never this.
 */
export function localSignIn(request: SignInRequest = {}): Promise<Profile> {
  return apiClient.post('/auth/local/signin', request, { schema: ProfileSchema })
}

/**
 * Every account enrolled on this device, oldest first.
 *
 * Reachable while signed out — it is what the picker is built from, and a
 * learner who has just signed out of their only account must still see it.
 */
export function fetchProfiles(): Promise<Profile[]> {
  return apiClient.get('/auth/profiles', { schema: z.array(ProfileSchema) })
}

/**
 * Opens an already-enrolled account.
 *
 * Reaches no identity mechanism, which is what makes it work offline and for
 * an account whose originating mechanism this backend no longer offers.
 */
export function activateProfile(profileId: string): Promise<Profile> {
  return apiClient.post(`/auth/profiles/${profileId}/activate`, {}, { schema: ProfileSchema })
}

export function signOut(): Promise<void> {
  return apiClient
    .post('/auth/signout', {}, { schema: z.unknown() })
    .then(() => undefined)
    .catch((error: unknown) => {
      // Sign-out is idempotent and carries no payload worth reading, so an
      // empty or unparseable body still means the session is gone. Transport
      // and status failures keep propagating — those did not clear anything.
      if (error instanceof ApiValidationError) return
      throw error
    })
}
