import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// The fake agent reports model and mode options and announces `/compact`, the
// shape both real agents were measured to use, so the palette has session
// controls and agent commands to offer.
const FAKE_AGENT = fileURLToPath(new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url))

async function register(page: Page): Promise<void> {
  const response = await page.request.post('/api/agents', {
    data: { name: 'Fake Agent', command: 'python3', args: [FAKE_AGENT, '--config-options', '--sessions-dir', join(tmpdir(), `ln-e2e-palette-${Date.now()}`)] },
  })
  expect(response.ok()).toBe(true)
  // Registered through the API, so the window's agent list is read again.
  await page.reload()
}

async function startSession(page: Page, topic: string): Promise<void> {
  // The empty workspace shows the button in the center; once sessions exist it
  // is only reachable from the palette, which is itself under test below.
  await page.getByRole('button', { name: 'Start with a topic…' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Start a session' })
  await dialog.getByLabel('Topic').fill(topic)
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByTestId('center-region').getByRole('heading', { name: topic })).toBeVisible()
}

function composer(page: Page) {
  return page.getByRole('textbox', { name: 'Message', exact: true })
}

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
}

/** Opens the palette with the shortcut and types a query into it. */
async function ask(page: Page, query: string) {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill(query)
  return palette
}

test('the palette opens over a draft, runs commands, opens nodes and never sends', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await createProfile(page, 'Palette Spec')
  await register(page)
  await startSession(page, 'Alpha topic')
  const center = page.getByTestId('center-region')

  // From the composer: the draft survives, the keystroke is not typed, and
  // Escape hands focus back to the composer.
  await composer(page).fill('half-written thought')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('combobox')).toBeFocused()
  await expect(palette.getByRole('combobox')).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
  await expect(composer(page)).toBeFocused()
  await expect(composer(page)).toHaveValue('half-written thought')

  // "New session" starts a session as the button does.
  await composer(page).fill('')
  await ask(page, 'new session')
  await page.keyboard.press('Enter')
  await expect(center.getByRole('heading', { name: 'New session' })).toBeVisible()

  // A node is opened by its title.
  await ask(page, 'alpha')
  await page.keyboard.press('Enter')
  await expect(center.getByRole('heading', { name: 'Alpha topic' })).toBeVisible()

  // Once the agent has answered, its commands are known: placed, not sent.
  await send(page, 'hello')
  const answers = await center.getByText('chunk 0').count()
  // The agent's offer is re-read once the turn settles; the list follows it.
  const agentCommands = await ask(page, 'compact')
  await expect(agentCommands.getByRole('option', { name: /\/compact/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden()
  await expect(composer(page)).toHaveValue('/compact ')
  await expect(composer(page)).toBeFocused()
  await page.waitForTimeout(500)
  await expect(center.getByText('chunk 0')).toHaveCount(answers)
  await expect(center.getByText('compacted')).toHaveCount(0)

  // A model chosen from the palette is the session controls' model.
  await composer(page).fill('')
  const models = await ask(page, 'model smart')
  await expect(models.getByRole('option', { name: /Model: Smart/i })).toBeVisible()
  await page.keyboard.press('Enter')
  const controls = center.getByTestId('session-controls')
  await controls.getByRole('button', { name: /Session settings/ }).click()
  await expect(controls.getByLabel('Model')).toHaveValue('smart-2')

  // A mode that acts without asking is listed, with a reason, and inert.
  const modes = await ask(page, 'bypass')
  const unasked = modes.getByRole('option', { name: /Mode: Bypass/i })
  await expect(unasked).toHaveAttribute('aria-disabled', 'true')
  await expect(unasked).toContainText('session controls')
  await page.keyboard.press('Enter')
  await expect(modes).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(controls.getByLabel('Permissions')).not.toHaveValue('bypassPermissions')
})

test('the palette is legible at 800x600 and leaves the three panes where they are', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await page.goto('/')
  await createProfile(page, 'Palette Small Spec')
  const rects = async () => ({
    left: await page.getByTestId('left-rail').boundingBox(),
    center: await page.getByTestId('center-region').boundingBox(),
    right: await page.getByTestId('right-rail').boundingBox(),
  })
  const before = await rects()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  const box = await palette.boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(600)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(800)
  await expect(palette.getByRole('option').first()).toBeVisible()
  expect(await rects()).toEqual(before)

  await page.keyboard.press('Escape')
  expect(await rects()).toEqual(before)
})
