import { type Page } from '@playwright/test'

import { createProfile, expect, selectProfile, signOut, test } from './fixtures'

// Distinct from the names `account.spec.ts` uses, and distinct per test,
// because both specs share one backend and one data directory for the run:
// a collision would put two tests' picker entries into the same list, and
// `selectProfile`'s index would then name a different account than intended.
const SOLO = 'Solo Learner'
const TWIN = 'Twin'
const RETURNING = 'Returning Learner'

/**
 * Nothing in the UI creates a *root* node yet — that is the study launcher,
 * Phase 13 — so the first node enters through the API the app itself calls,
 * matching `account.spec.ts`.
 */
async function createRootNode(page: Page, title: string): Promise<void> {
  const response = await page.request.post('/api/workspace/nodes', {
    data: { title, mode: 'Explore' },
  })
  expect(response.ok()).toBeTruthy()
  // The snapshot the store is holding predates this node; only a fresh
  // hydration will show it.
  await page.reload()
  await expect(page.getByTestId('left-rail')).toBeVisible()
}

test.describe('local profiles', () => {
  test('a learner can create a profile by name and reach the workspace', async ({ page }) => {
    await page.goto('/')

    // The dead end this change removes. Before it, a surface with the
    // development gate shut had nothing to click at all — it could only report
    // that no sign-in method was available.
    const surface = page.getByTestId('sign-in-surface')
    await expect(surface).toBeVisible()
    await expect(surface.getByRole('button', { name: /create a profile/i })).toBeEnabled()

    await createProfile(page, SOLO)

    await expect(page.getByTestId('center-region')).toBeVisible()
    await expect(page.getByTestId('right-rail')).toBeVisible()
  })

  test('two profiles created with one name are two separate graphs', async ({ page }) => {
    const topic = 'Twin Topic'

    await page.goto('/')
    await createProfile(page, TWIN)
    await createRootNode(page, topic)
    await expect(
      page.getByTestId('left-rail').getByRole('button', { name: topic, exact: true }),
    ).toBeVisible()
    await signOut(page)

    // The same name again. A mechanism deriving its subject from the name — as
    // the development one does — would return the first account here, and the
    // absence below would fail.
    await createProfile(page, TWIN)
    await expect(page.getByText(topic, { exact: true })).toHaveCount(0)
    // No sessions of its own. The rail always offers "Start a new session",
    // so count the history's entries rather than every button in it.
    await expect(page.getByTestId('left-rail').getByTestId('session-entry')).toHaveCount(0)
    await signOut(page)

    // Both are individually reachable under the one label, which is what makes
    // a random subject usable rather than a way to lose an account. Asserted by
    // selecting each rather than by counting picker entries: a count would be
    // wrong on a retry, which enrolls the pair a second time.
    await selectProfile(page, TWIN, 0)
    await expect(
      page.getByTestId('left-rail').getByRole('button', { name: topic, exact: true }),
    ).toBeVisible()
    await signOut(page)

    await selectProfile(page, TWIN, 1)
    await expect(page.getByText(topic, { exact: true })).toHaveCount(0)
  })

  test('signing out and selecting the earlier profile brings its graph back', async ({
    page,
  }) => {
    const topic = 'Returning Topic'

    await page.goto('/')
    await createProfile(page, RETURNING)
    await createRootNode(page, topic)
    await signOut(page)

    // A second account, so the return below is a genuine selection rather than
    // the only account being reactivated by default.
    await createProfile(page, `${RETURNING} Two`)
    await expect(page.getByText(topic, { exact: true })).toHaveCount(0)
    await signOut(page)

    // Oldest-first ordering means index 0 is the account that owns the node.
    await selectProfile(page, RETURNING, 0)

    await expect(
      page.getByTestId('left-rail').getByRole('button', { name: topic, exact: true }),
    ).toBeVisible()
  })
})
