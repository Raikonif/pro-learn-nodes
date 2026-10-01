import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, launchSignedIn, test } from './fixtures'

// This file's own account, so its agents and nodes collide with no other spec.
const ACCOUNT = 'Agent Chat Spec'
const AGENT = 'Fake Agent'
const NODE = 'Agent Conversation'

// The same fake the backend suite drives: a real subprocess speaking ACP, so
// the whole path — browser, proxy, route, supervisor, client, process — is
// exercised, and no subscription is spent. Slow chunks leave time to see the
// turn arrive and to stop it partway.
const FAKE_AGENT = fileURLToPath(
  new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url),
)

test.describe('a node conversation on an agent', () => {
  test.beforeEach(async ({ page }) => {
    await launchSignedIn(page, ACCOUNT)

    const { agents } = await (await page.request.get('/api/agents')).json()
    if (!agents.some((agent: { name: string }) => agent.name === AGENT)) {
      const registered = await page.request.post('/api/agents', {
        data: {
          name: AGENT,
          command: 'python3',
          args: [
            FAKE_AGENT,
            '--chunks', '8',
            '--delay', '0.4',
            '--sessions-dir', join(tmpdir(), `learn-nodes-e2e-agent-${Date.now()}`),
          ],
        },
      })
      expect(registered.ok()).toBe(true)
    }
    const snapshot = await (await page.request.get('/api/workspace/bootstrap')).json()
    if (!snapshot.graph.nodes.some((node: { title: string }) => node.title === NODE)) {
      await page.request.post('/api/workspace/nodes', { data: { title: NODE, mode: 'Explore' } })
    }
    await page.reload()
    await expect(page.getByTestId('left-rail')).toBeVisible()
  })

  test('the registered agent passes its connection test', async ({ page }) => {
    await page.getByRole('button', { name: 'Agent settings' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: `Test ${AGENT}` }).click()
    await expect(dialog.getByText(/Connected to/)).toBeVisible()
  })

  test('a turn streams, stops partway, and is kept as cancelled after a reload', async ({ page }) => {
    const center = page.getByTestId('center-region')
    await center.getByRole('button', { name: NODE, exact: true }).click()

    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Explain recursion')
    await page.getByRole('button', { name: 'Send' }).click()

    // Text is on screen while the turn is still running — not at the end.
    const live = page.getByTestId('live-agent-message').last()
    await expect(live).toContainText('chunk 0')
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()

    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByTestId('turn-outcome').last()).toContainText('Cancelled')
    // The composer is usable at once.
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Next question')
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()

    // The workspace reopens the last open node on its own; the turn is read
    // back from the backend's record, not from anything held in the page.
    await page.reload()
    await expect(center.getByText(/chunk 0/).last()).toBeVisible()
    await expect(page.getByTestId('turn-outcome').last()).toContainText('Cancelled')
  })
})
