import { test as base, expect, type Page } from '@playwright/test'

/**
 * Every workspace route is scoped to the active account, so a spec that opens
 * `/` without signing in lands on the sign-in surface and never sees a pane.
 * These helpers are the shared way in.
 *
 * Sign-in is driven through the real surface rather than through
 * `POST /auth/dev/signin` directly: the endpoint is already covered by the
 * backend suite, and the only thing an E2E run adds is proof that the control
 * a learner actually clicks reaches it. The API is used for *teardown* below,
 * where there is no learner and no assertion to make.
 */

/**
 * The active account is a single pointer in the backend's secret store, not a
 * per-browser cookie, so it outlives the page context that set it — including
 * across specs and across whole runs, since on macOS that store is the
 * Keychain. A test that assumes it starts signed out has to say so.
 */
export const test = base.extend<{ signedOut: void }>({
  signedOut: [
    async ({ request }, use) => {
      await request.post('/api/auth/signout')
      await use()
      // Cleared afterwards as well, so a run does not leave a pointer behind
      // for the next thing that reads that store — on macOS it is the login
      // Keychain, which outlives the throwaway database it refers to.
      await request.post('/api/auth/signout')
    },
    { auto: true },
  ],
})

export { expect }

/**
 * Signs in and waits for the workspace to have actually rendered, not merely
 * for the request to have returned: the panes appear only after the new
 * account's snapshot is hydrated, and returning before that hands the caller a
 * page whose next click lands on nothing.
 *
 * The display name doubles as the account's identity here. The development
 * adapter derives its subject from the email and falls back to the display
 * name, and the surface offers no email field — so two sign-ins with the same
 * name are the same account, and a test meaning to use two must pass two
 * distinct names.
 */
export async function signIn(page: Page, displayName: string): Promise<void> {
  const surface = page.getByTestId('sign-in-surface')
  await expect(surface).toBeVisible()
  await surface.getByLabel(/display name/i).fill(displayName)
  await surface.getByRole('button', { name: /development sign-in/i }).click()
  await expect(page.getByTestId('account-identity')).toHaveText(displayName)
  await expect(page.getByTestId('left-rail')).toBeVisible()
}

/** Opens the app signed out and signs in, for specs that only need to be inside. */
export async function launchSignedIn(page: Page, displayName: string): Promise<void> {
  await page.goto('/')
  await signIn(page, displayName)
}

/** Leaves the account through the header affordance, as a learner would. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByTestId('sign-in-surface')).toBeVisible()
}

/**
 * Creates a *new* account through the local mechanism and waits for the
 * workspace to render.
 *
 * Deliberately not interchangeable with `signIn`. The local mechanism mints a
 * fresh subject per request, so calling this twice with one name produces two
 * accounts — which is the behaviour `local-profile.spec.ts` exists to prove,
 * and exactly what would make an isolation test using it silently compare two
 * different graphs when it meant to compare one against itself.
 */
export async function createProfile(page: Page, displayName: string): Promise<void> {
  const surface = page.getByTestId('sign-in-surface')
  await expect(surface).toBeVisible()
  await surface.getByLabel(/display name/i).fill(displayName)
  await surface.getByRole('button', { name: /create a profile/i }).click()
  await expect(page.getByTestId('account-identity')).toHaveText(displayName)
  await expect(page.getByTestId('left-rail')).toBeVisible()
}

/**
 * Returns to an already-enrolled account by selecting it from the picker.
 *
 * `index` disambiguates accounts sharing a display name, which the local
 * mechanism permits on purpose. The picker is ordered oldest-first, so index 0
 * is the earliest account enrolled under that label.
 */
export async function selectProfile(page: Page, label: string, index = 0): Promise<void> {
  const picker = page.getByTestId('profile-picker')
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: new RegExp(label) }).nth(index).click()
  await expect(page.getByTestId('left-rail')).toBeVisible()
}
