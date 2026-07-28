import { test, expect } from '@playwright/test'

test.describe('App', () => {
  test('app launches and displays the home screen', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Learn Nodes')).toBeVisible()
    await expect(page.getByText('Phase 1 — Project Skeleton')).toBeVisible()
  })

  test('backend health check passes', async ({ page }) => {
    await page.goto('/')
    // Wait for backend status to update from "checking..."
    const backendMessage = page.locator('#backend-message')
    await expect(backendMessage).not.toHaveText('checking...', { timeout: 10000 })
  })
})
