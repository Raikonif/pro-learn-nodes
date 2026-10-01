import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// The same fake agent the backend suite drives — a real ACP subprocess — so a
// turn really runs, and no subscription is spent.
const FAKE_AGENT = fileURLToPath(
  new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url),
)

// A word unlikely to appear anywhere else, so search has exactly one answer.
const QUESTION = 'Explain zygomorphisms with a small example'

async function registerFakeAgent(page: Page): Promise<void> {
  const registered = await page.request.post('/api/agents', {
    data: {
      name: 'Fake Agent',
      command: 'python3',
      args: [FAKE_AGENT, '--chunks', '2', '--sessions-dir', join(tmpdir(), `ln-e2e-sessions-${Date.now()}`)],
    },
  })
  expect(registered.ok()).toBe(true)
}

test.describe('sessions', () => {
  test('a new account starts, titles, finds, archives, and restores a session', async ({ page }) => {
    await page.goto('/')
    // A local profile is always a new account with an empty graph.
    await createProfile(page, 'Sessions Spec')
    await registerFakeAgent(page)
    const rail = page.getByTestId('left-rail')
    const center = page.getByTestId('center-region')

    // Empty workspace: both starts in the center, no history entries yet.
    const empty = center.getByTestId('empty-workspace-start')
    await expect(empty).toBeVisible()
    await expect(empty.getByRole('button', { name: 'Start with a topic…' })).toBeVisible()
    await expect(rail.getByTestId('session-entry')).toHaveCount(0)

    // Quick start: the composer is ready at once.
    await empty.getByRole('button', { name: 'Start a new session' }).click()
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeFocused()
    await composer.fill(QUESTION)
    await page.getByRole('button', { name: 'Send' }).click()
    // Two quick chunks: the turn is over almost at once, so wait for the
    // recorded reply rather than the live one.
    await expect(center.getByText('chunk 0 chunk 1', { exact: true })).toBeVisible()

    // Titled from the first message, listed under Today.
    const today = rail.getByRole('region', { name: 'Today' })
    await expect(today.getByRole('button', { name: QUESTION, exact: true })).toBeVisible()

    // Search by title finds it; search by something said only in the
    // conversation opens it at that message.
    await rail.getByRole('button', { name: 'Start a new session' }).click()
    const search = rail.getByRole('searchbox', { name: 'Search sessions' })
    await search.fill('zygomorphisms')
    await expect(rail.getByTestId('search-result')).toHaveCount(1)
    await search.fill('chunk')
    const result = rail.getByTestId('search-result').first()
    await expect(result).toContainText('chunk 0 chunk 1')
    await result.getByRole('button', { name: QUESTION }).click()
    await expect(center.getByRole('heading', { name: QUESTION })).toBeVisible()
    await expect(center.locator('[data-highlighted="true"]')).toContainText('chunk 0 chunk 1')

    // Archive: gone from the history and the graph, kept whole.
    await rail.getByRole('searchbox', { name: 'Search sessions' }).fill('')
    await rail.getByRole('button', { name: `Archive ${QUESTION}` }).click()
    await expect(rail.getByRole('button', { name: QUESTION, exact: true })).toHaveCount(0)
    await expect(page.getByText(QUESTION, { exact: true })).toHaveCount(0)

    // Found again only when archived sessions are included; restored intact.
    await rail.getByRole('searchbox', { name: 'Search sessions' }).fill('zygomorphisms')
    await expect(rail.getByTestId('search-result')).toHaveCount(0)
    await rail.getByLabel('Include archived').check()
    await rail.getByRole('button', { name: `Restore ${QUESTION}` }).click()
    await rail.getByRole('searchbox', { name: 'Search sessions' }).fill('')
    await expect(rail.getByRole('button', { name: QUESTION, exact: true })).toBeVisible()
    await rail.getByRole('button', { name: QUESTION, exact: true }).click()
    await expect(center.getByText(QUESTION, { exact: true })).toBeVisible()
    await expect(center.getByText(/chunk 0 chunk 1/)).toBeVisible()
  })

  test('a detailed start carries its topic and mode', async ({ page }) => {
    await page.goto('/')
    await createProfile(page, 'Detailed Start Spec')
    const center = page.getByTestId('center-region')

    await center.getByRole('button', { name: 'Start with a topic…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Start a session' })
    await dialog.getByLabel('Topic').fill('Paramorphisms')
    await dialog.getByLabel('Mode').selectOption('Deepen')
    await dialog.getByRole('button', { name: 'Start', exact: true }).click()

    await expect(dialog).toHaveCount(0)
    await expect(center.getByRole('heading', { name: 'Paramorphisms' })).toBeVisible()
    await expect(center.getByText('Deepen', { exact: true })).toBeVisible()
    await expect(
      page.getByTestId('left-rail').getByRole('button', { name: 'Paramorphisms', exact: true }),
    ).toBeVisible()
  })
})
