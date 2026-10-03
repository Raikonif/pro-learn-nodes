import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// The workbench end to end, against the same ACP fake agent as the context
// specs: deliveries become blocks, blocks close and come back, and the
// arrangement is this device's.
const FAKE_AGENT = fileURLToPath(new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url))

async function register(page: Page, name: string): Promise<void> {
  const response = await page.request.post('/api/agents', {
    data: { name, command: 'python3', args: [FAKE_AGENT, '--sessions-dir', join(tmpdir(), `ln-e2e-wb-${Date.now()}`)] },
  })
  expect(response.ok()).toBe(true)
}

async function startSession(page: Page, topic: string): Promise<void> {
  await page.getByTestId('center-region').getByRole('button', { name: 'Start with a topic…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Start a session' })
  await dialog.getByLabel('Topic').fill(topic)
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByTestId('center-region').getByRole('heading', { name: topic })).toBeVisible()
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
}

test.describe('practice workbench', () => {
  test('two deliveries are two blocks; a closed one comes back from the conversation; the arrangement survives a reload', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await createProfile(page, 'Workbench Spec')
    await register(page, 'Fake Agent')
    await startSession(page, 'Generators')
    const rail = page.getByTestId('practice-rail')
    const blocks = rail.getByTestId('practice-block')
    const quizHeaders = rail.getByRole('button', { name: /^Quiz: .*, by Fake Agent/ })

    await send(page, '/quiz two questions on generators')
    await send(page, '/quiz two more')
    await expect(blocks).toHaveCount(2)
    // The newest delivery is the expanded one; the first is a header.
    await expect(quizHeaders.nth(0)).toHaveAttribute('aria-expanded', 'true')
    await expect(quizHeaders.nth(1)).toHaveAttribute('aria-expanded', 'false')
    // The minimap gives the expanded block its height.
    await expect(page.getByTestId('graph-breadcrumb')).toBeVisible()

    // Answer one question of the expanded block; its header counts it.
    const expanded = rail.getByTestId('practice-block').nth(0).getByRole('region')
    await expanded.getByRole('radio').first().check()
    await expanded.getByRole('button', { name: /submit/i }).first().click()
    await expect(quizHeaders.nth(0)).toHaveAccessibleName(/1\/2 answered/)

    // Close the older block: it leaves the list and is listed as closed.
    await rail.getByRole('button', { name: /^Close Quiz: / }).nth(1).click()
    await expect(blocks).toHaveCount(1)
    await expect(rail.getByRole('button', { name: 'Closed (1)' })).toBeVisible()

    // Its delivery record in the conversation brings it back, expanded.
    await page.getByTestId('center-region').getByRole('button', { name: 'Open in Quiz →' }).first().click()
    await expect(blocks).toHaveCount(2)
    await expect(rail.getByRole('button', { name: 'Closed (1)' })).toHaveCount(0)
    await expect(quizHeaders.nth(1)).toHaveAttribute('aria-expanded', 'true')

    // The arrangement is this device's: after a reload, the same block is expanded.
    await page.reload()
    await expect(quizHeaders.nth(1)).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 })
    await expect(quizHeaders.nth(0)).toHaveAttribute('aria-expanded', 'false')
  })

  test('asking the agent from the add control places the command and sends nothing', async ({ page }) => {
    await page.goto('/')
    await createProfile(page, 'Workbench Ask Spec')
    await register(page, 'Fake Agent')
    await startSession(page, 'Closures')
    const rail = page.getByTestId('practice-rail')

    await expect(rail.getByTestId('workbench-empty')).toBeVisible()
    await rail.getByRole('button', { name: '+ Add' }).click()
    await page.getByRole('menuitem', { name: /Ask the agent for an exercise/ }).click()

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toHaveValue('/code ')
    await expect(composer).toBeFocused()
    await expect(page.getByTestId('center-region').getByTestId('practice-delivered')).toHaveCount(0)
  })
})
