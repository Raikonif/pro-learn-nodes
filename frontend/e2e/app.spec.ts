import { test, expect } from '@playwright/test'

test.describe('App', () => {
  test('app launches and displays the home screen', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Learn Nodes')).toBeVisible()
    await expect(page.getByText('Phase 1 — Project Skeleton')).toBeVisible()
  })

  test('backend health check passes', async ({ page }) => {
    await page.goto('/')
    // Assert the *connected* state specifically. Asserting merely that the text
    // left "checking..." would also pass when the backend is down, since a
    // failed request renders "unavailable".
    const backendMessage = page.locator('#backend-message')
    await expect(backendMessage).toHaveText('connected', { timeout: 10000 })
  })
})
