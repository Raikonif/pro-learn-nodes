import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// The fake agent asks to write `notes.md` in its working directory on every
// turn, with one-time options, then says how it was answered:
// "permission selected allow", "permission selected reject", or
// "permission cancelled".
const FAKE_AGENT = fileURLToPath(new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url))

const center = (page: Page) => page.getByTestId('center-region')
const request = (page: Page) => center(page).getByTestId('permission-request')
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true })

async function startSession(page: Page, topic: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('Start with a topic')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Start a session' })
  await dialog.getByLabel('Topic').fill(topic)
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(center(page).getByRole('heading', { name: topic })).toBeVisible()
}

/** Send without waiting for the turn to end: it will wait on a permission request. */
async function ask(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

async function turnEnded(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
}

async function answerInline(page: Page, allow: boolean, remember = false): Promise<void> {
  await expect(request(page)).toBeVisible({ timeout: 30_000 })
  if (remember) await request(page).getByRole('checkbox').check()
  await request(page).getByRole('button', { name: allow ? 'Allow' : 'Refuse', exact: true }).click()
  await expect(request(page)).toHaveCount(0)
}

async function pending(page: Page): Promise<unknown[]> {
  return (await page.request.get('/api/permissions/pending')).json()
}

test('an agent asks, is answered inline or from elsewhere, and a remembered answer is kept until revoked', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/')
  await createProfile(page, 'Permissions Spec')
  const response = await page.request.post('/api/agents', {
    data: {
      name: 'Fake Agent',
      command: 'python3',
      args: [FAKE_AGENT, '--request-permission', '--sessions-dir', join(tmpdir(), `ln-e2e-perm-${Date.now()}`)],
    },
  })
  expect(response.ok()).toBe(true)
  await page.reload()
  await page.getByTestId('center-region').getByRole('button', { name: 'Start with a topic…' }).click()
  const start = page.getByRole('dialog', { name: 'Start a session' })
  await start.getByLabel('Topic').fill('Loops')
  await start.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(center(page).getByRole('heading', { name: 'Loops' })).toBeVisible()

  // Asked before writing; allowed, the agent acts and the answer is recorded.
  await ask(page, 'take notes')
  await expect(request(page)).toContainText('Write notes.md')
  await answerInline(page, true)
  await turnEnded(page)
  await expect(center(page).getByText('permission selected allow').last()).toBeVisible()
  await expect(center(page).getByTestId('permission-decision').last()).toContainText('Allowed: Write notes.md')

  // Refused, the turn still finishes.
  await ask(page, 'again')
  await answerInline(page, false)
  await turnEnded(page)
  await expect(center(page).getByText('permission selected reject').last()).toBeVisible()
  await expect(center(page).getByTestId('permission-decision').last()).toContainText('Refused: Write notes.md')

  // Remembered for this node: the next request of that kind is not asked.
  await ask(page, 'remember it')
  await answerInline(page, true, true)
  await turnEnded(page)
  await ask(page, 'once more')
  await turnEnded(page)
  await expect(request(page)).toHaveCount(0)
  await expect(center(page).getByText('permission selected allow').last()).toBeVisible()

  // Another node is asked again; answered from the indicator while a third node is open.
  await startSession(page, 'Recursion')
  await ask(page, 'take notes')
  await expect(request(page)).toBeVisible({ timeout: 30_000 })
  await startSession(page, 'Sorting')
  const indicator = page.getByTestId('permission-indicator')
  await expect(indicator).toContainText('1 agent asks permission')
  await indicator.click()
  const panel = page.getByRole('dialog', { name: 'Waiting permission requests' })
  await expect(panel).toContainText('Recursion')
  await panel.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(indicator).toHaveCount(0)
  await expect.poll(() => pending(page)).toEqual([])

  // Revoked in Settings, the remembered node asks again.
  await page.getByRole('button', { name: 'Agent settings' }).click()
  const settings = page.getByRole('dialog')
  const remembered = settings.getByRole('region', { name: 'Remembered permissions' })
  await expect(remembered).toContainText('Loops')
  await remembered.getByRole('button', { name: /Revoke/ }).click()
  await expect(remembered.getByRole('button', { name: /Revoke/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByTestId('left-rail').getByText('Loops', { exact: true }).first().click()
  await expect(center(page).getByRole('heading', { name: 'Loops' })).toBeVisible()
  await ask(page, 'after revoking')
  await expect(request(page)).toBeVisible({ timeout: 30_000 })

  // Stopping a turn that waits leaves nothing pending anywhere.
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await turnEnded(page)
  await expect(request(page)).toHaveCount(0)
  await expect.poll(() => pending(page)).toEqual([])
  await expect(page.getByTestId('permission-indicator')).toHaveCount(0)
})
