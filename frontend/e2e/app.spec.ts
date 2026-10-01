import { expect, launchSignedIn, test } from './fixtures'

// One name for this file, distinct from the accounts other specs use, so a
// failure here can never be another spec's data arriving.
const ACCOUNT = 'App Spec'

test.describe('App', () => {
  test('app launches and displays the workspace', async ({ page }) => {
    await launchSignedIn(page, ACCOUNT)
    await expect(page.getByRole('heading', { name: 'Learn Nodes' })).toBeVisible()
    await expect(page.getByTestId('left-rail')).toBeVisible()
    await expect(page.getByTestId('center-region')).toBeVisible()
    await expect(page.getByTestId('right-rail')).toBeVisible()
  })

  test('backend health check passes', async ({ page }) => {
    await launchSignedIn(page, ACCOUNT)
    // Assert the *online* state specifically. A request that hasn't
    // resolved yet renders "Backend offline" (the initial state), so this
    // also fails when the backend is down.
    const backendMessage = page.locator('#backend-message')
    await expect(backendMessage).toHaveText('Backend online', { timeout: 10000 })
  })
})
