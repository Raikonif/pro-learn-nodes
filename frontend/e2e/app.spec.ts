import { test, expect } from '@playwright/test'

test.describe('App', () => {
  test('app launches and displays the home screen', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Learn Nodes' })).toBeVisible()
    await expect(page.getByText('Phase 1 — Project Skeleton')).toBeVisible()
  })

  test('backend health check passes', async ({ page }) => {
    await page.goto('/')
    // Assert the *online* state specifically. A request that hasn't
    // resolved yet renders "Backend offline" (the initial state), so this
    // also fails when the backend is down.
    const backendMessage = page.locator('#backend-message')
    await expect(backendMessage).toHaveText('Backend online', { timeout: 10000 })
  })
})
