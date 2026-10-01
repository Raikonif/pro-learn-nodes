import { type Page } from '@playwright/test'

import { expect, signIn, signOut, test } from './fixtures'

// Two names, because the development adapter derives its subject from the
// email and falls back to the display name: sign in twice with one name and
// both sign-ins resolve to the same account, so the test would compare an
// account's graph against itself and pass while proving nothing.
const ACCOUNT_A = 'Ada'
const ACCOUNT_B = 'Grace'

const TOPIC = 'Isolation Topic'
const CHILD = `New child of ${TOPIC}`

/**
 * Nothing in the UI creates a *root* node yet — that is the study launcher,
 * Phase 13 — so the first node has to enter through the API the app itself
 * calls. The child below is created by clicking, which is what keeps a real
 * mutation on the happy path.
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

test.describe('account isolation', () => {
  test("an account's graph is invisible to every other account", async ({ page }) => {
    await page.goto('/')

    // Signed out is not a workspace with an empty graph — the panes must not
    // exist at all, or a stale snapshot could be read as somebody's data.
    await expect(page.getByTestId('sign-in-surface')).toBeVisible()
    await expect(page.getByTestId('left-rail')).toHaveCount(0)
    await expect(page.getByTestId('center-region')).toHaveCount(0)
    await expect(page.getByTestId('right-rail')).toHaveCount(0)

    await signIn(page, ACCOUNT_A)
    const center = page.getByTestId('center-region')
    await expect(center).toBeVisible()
    await expect(page.getByTestId('right-rail')).toBeVisible()

    await createRootNode(page, TOPIC)
    await expect(center.getByRole('button', { name: TOPIC, exact: true })).toBeVisible()
    await center.getByRole('button', { name: `Create child node from ${TOPIC}` }).click()
    await expect(center.getByRole('heading', { name: CHILD })).toBeVisible()

    // The very locators the absence assertions below use, asserted present
    // while A is active. An absence that was never a presence proves nothing,
    // and a mistyped title would give exactly that.
    await expect(page.getByText(TOPIC, { exact: true })).not.toHaveCount(0)
    await expect(page.getByText(CHILD, { exact: true })).not.toHaveCount(0)

    await signOut(page)

    await signIn(page, ACCOUNT_B)
    // The absences are the requirement. A test that only checked that B's
    // workspace renders would pass just as happily if both accounts shared
    // one graph, so assert against the whole page rather than one pane: a
    // title of A's must not survive anywhere, including the left rail's
    // index, the graph canvas, and the right rail's minimap.
    await expect(page.getByText(TOPIC, { exact: true })).toHaveCount(0)
    await expect(page.getByText(CHILD, { exact: true })).toHaveCount(0)
    // No sessions of its own. The rail always offers "Start a new session",
    // so count the history's entries rather than every button in it.
    await expect(page.getByTestId('left-rail').getByTestId('session-entry')).toHaveCount(0)

    await signOut(page)

    await signIn(page, ACCOUNT_A)
    // Switching accounts is not deletion: A's graph comes back as it was,
    // both the node created through the API and the one created by clicking.
    const leftRail = page.getByTestId('left-rail')
    await expect(leftRail.getByRole('button', { name: TOPIC, exact: true })).toBeVisible()
    await expect(leftRail.getByRole('button', { name: CHILD, exact: true })).toBeVisible()
  })
})
