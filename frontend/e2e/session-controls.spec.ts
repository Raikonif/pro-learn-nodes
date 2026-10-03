import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// The fake agent reports model, effort, mode, and fast options and announces
// commands, in the shape both real agents were measured to use; `whoami`
// answers with what its session is actually running with.
const FAKE_AGENT = fileURLToPath(new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url))

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
}

test('a session runs on the chosen model, asks before going unasked, and reaches the agent\'s commands', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await createProfile(page, 'Session Controls Spec')
  await page.request.post('/api/agents', {
    data: { name: 'Fake Agent', command: 'python3', args: [FAKE_AGENT, '--config-options', '--sessions-dir', join(tmpdir(), `ln-e2e-ctl-${Date.now()}`)] },
  })
  // Registered through the API, so the window's agent list is read again.
  await page.reload()
  await page.getByTestId('center-region').getByRole('button', { name: 'Start with a topic…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Start a session' })
  await dialog.getByLabel('Topic').fill('Controls')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  const center = page.getByTestId('center-region')
  const controls = center.getByTestId('session-controls')

  // Choose a model and fast mode; the agent reports running with them.
  await controls.getByRole('button', { name: /Session settings/ }).click()
  await controls.getByLabel('Model').selectOption('smart-2')
  // A controlled switch: it moves once the choice is saved.
  await controls.getByRole('switch', { name: 'Fast' }).click()
  await expect(controls.getByRole('switch', { name: 'Fast' })).toBeChecked()
  await send(page, 'whoami')
  await expect(center.getByText(/model=smart-2 .*fast=on/).last()).toBeVisible()
  await expect(center.getByTestId('context-usage')).toContainText('200k')

  // A mode that acts without asking needs confirmation, then marks the session.
  await controls.getByLabel('Permissions').selectOption('bypassPermissions')
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('without asking')
  await confirm.getByRole('button', { name: 'Allow acting without asking' }).click()
  await expect(controls.getByTestId('acts-unasked-marker')).toBeVisible()
  await send(page, 'whoami')
  await expect(center.getByText(/mode=bypassPermissions/).last()).toBeVisible()

  // The agent's own commands are in the / menu, and reach the agent.
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('/comp')
  await page.getByRole('option', { name: /compact/ }).click()
  await expect(composer).toHaveValue('/compact ')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(center.getByText('compacted').last()).toBeVisible()
})
