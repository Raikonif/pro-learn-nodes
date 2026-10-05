import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// `write-code` makes the fake agent write loops.py (valid) and broken.py (a
// syntax error) into its working directory and quote a fenced Python block;
// `slow-story` streams eight parts half a second apart.
const FAKE_AGENT = fileURLToPath(new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url))

const center = (page: Page) => page.getByTestId('center-region')
const codeTab = (page: Page) => center(page).getByRole('tab', { name: /^Code/ })
const conversationTab = (page: Page) => center(page).getByRole('tab', { name: /^Conversation/ })

async function send(page: Page, text: string, { wait = true } = {}): Promise<void> {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  if (wait) await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
}

test('a node shows its code in a Code tab: highlighted, numbered, checked, read-only', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await createProfile(page, 'Code Viewer Spec')
  const response = await page.request.post('/api/agents', {
    data: { name: 'Fake Agent', command: 'python3', args: [FAKE_AGENT, '--sessions-dir', join(tmpdir(), `ln-e2e-code-${Date.now()}`)] },
  })
  expect(response.ok()).toBe(true)
  await page.reload()
  await center(page).getByRole('button', { name: 'Start with a topic…' }).click()
  const start = page.getByRole('dialog', { name: 'Start a session' })
  await start.getByLabel('Topic').fill('Loops')
  await start.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(center(page).getByRole('heading', { name: 'Loops' })).toBeVisible()

  // No code anywhere yet: no Code tab, no empty viewer.
  await send(page, 'hello')
  await expect(codeTab(page)).toHaveCount(0)

  // The agent writes files and quotes a block: the tab appears, the conversation still in front.
  await send(page, 'write-code')
  await expect(codeTab(page)).toBeVisible()
  await expect(conversationTab(page)).toHaveAttribute('aria-selected', 'true')
  const block = center(page).getByTestId('message-code-block').last()
  await expect(block.locator('.tok-keyword').first()).toHaveText('for')

  // A file: coloured by token kind, every line numbered, no syntax problems.
  await codeTab(page).click()
  const sources = center(page).getByRole('navigation', { name: 'Code sources' })
  await expect(sources).toContainText("Files in this node's folder")
  await expect(sources).toContainText('From the conversation')
  await sources.getByRole('button', { name: /loops\.py/ }).click()
  const loops = center(page).getByRole('figure', { name: 'loops.py' })
  await expect(loops.locator('.tok-className')).toHaveText('Counter')
  await expect(loops.locator('.tok-function').first()).toHaveText('count')
  await expect(loops.locator('[data-line]')).toHaveCount(5)
  await expect(center(page).getByText('No syntax problems found.')).toBeVisible()
  await expect(loops.locator('[contenteditable]')).toHaveCount(0)

  // A syntax error is marked and listed.
  await sources.getByRole('button', { name: /broken\.py/ }).click()
  await expect(center(page).getByRole('list', { name: 'Syntax problems' })).toContainText(/Line 1, column \d+: Syntax error/)
  await expect(center(page).getByTestId('diagnostic-marker').first()).toBeVisible()

  // "Open in Code" from the conversation shows that block.
  await conversationTab(page).click()
  await center(page).getByRole('button', { name: 'Open Python in Code' }).last().click()
  await expect(codeTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(center(page).getByRole('figure')).toHaveAttribute('data-language', 'python')
  await expect(center(page).getByRole('figure')).toContainText('print(i)')

  // A turn keeps streaming while Code is shown, and its tab says so.
  await conversationTab(page).click()
  await send(page, 'slow-story', { wait: false })
  await codeTab(page).click()
  await expect(center(page).getByTestId('conversation-running')).toBeVisible()
  await expect(center(page).getByTestId('conversation-running')).toHaveCount(0, { timeout: 30_000 })
  await conversationTab(page).click()
  await expect(center(page).getByText(/part 7/).last()).toBeVisible()

  // Legible at 800×600.
  await page.setViewportSize({ width: 800, height: 600 })
  await codeTab(page).click()
  await expect(codeTab(page)).toBeInViewport()
  await expect(center(page).getByRole('figure')).toBeInViewport()
})
