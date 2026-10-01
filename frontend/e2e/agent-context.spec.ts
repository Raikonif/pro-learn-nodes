import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// A real ACP subprocess that answers commands the way Codex and Claude were
// measured to: one tool call per question, then a pointer to the panel.
const FAKE_AGENT = fileURLToPath(new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url))

async function register(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/agents', {
    data: { name, command: 'python3', args: [FAKE_AGENT, '--sessions-dir', join(tmpdir(), `ln-e2e-ctx-${name}-${Date.now()}`)] },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()).id
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

test.describe('agents and the context server', () => {
  test('practice asked for in the chat arrives in the rail, is solved there, and the agent can read it', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await createProfile(page, 'Context Delivery Spec')
    await register(page, 'Fake Agent')
    await startSession(page, 'Comprehensions')
    const rail = page.getByRole('tablist', { name: 'Practice tools' }).locator('..')

    // /quiz → the rail switches to Quiz with the two new questions highlighted.
    await send(page, '/quiz two questions on comprehensions')
    await expect(page.getByRole('tab', { name: 'Quiz' })).toHaveAttribute('aria-selected', 'true')
    await expect(rail.locator('[data-highlighted="true"]')).toHaveCount(2)
    await expect(rail.getByText('Which builds a list from an iterable?')).toBeVisible()
    await expect(rail.getByText('by Fake Agent').first()).toBeVisible()
    await expect(page.getByTestId('center-region').getByText('Fake Agent sent 2 questions to Quiz')).toBeVisible()

    // /code → Code opens the exercise with its starter code.
    await send(page, '/code summing a list')
    await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    await expect(rail.getByRole('region', { name: 'Exercise' })).toContainText('Print the sum of numbers.')
    const code = page.getByLabel('Python code')
    await expect(code).toHaveValue('numbers = [1, 2, 3]\n')

    // The learner solves it in the rail and submits.
    await code.fill('numbers = [1, 2, 3]\nprint(sum(numbers))\n')
    await rail.getByRole('button', { name: 'Submit', exact: true }).click()
    const latest = rail.getByTestId('latest-submission')
    await expect(latest).toContainText('6', { timeout: 60_000 })
    await expect(latest).toContainText('matched the expected output')

    // The agent reads the learner's solution from its own working directory.
    await send(page, 'read-solution')
    await expect(page.getByTestId('center-region').getByText(/solution: numbers = \[1, 2, 3\]\s+print\(sum\(numbers\)\)/)).toBeVisible()
  })

  test('a memory one agent proposes is accepted by the learner and read by another agent', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await createProfile(page, 'Context Memory Spec')
    await register(page, 'Fake Agent')
    const second = await register(page, 'Second Agent')
    await startSession(page, 'Python')

    await send(page, 'mcp:propose_memory {"fact": "Knows list comprehensions", "topic": "python/comprehensions"}')

    await page.getByRole('button', { name: 'Memory', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Memory' })
    const pending = dialog.getByRole('region', { name: 'Pending proposals' })
    await expect(pending.getByText('Knows list comprehensions')).toBeVisible()
    await pending.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(dialog.getByRole('region', { name: 'Accepted memories' }).getByText('Knows list comprehensions')).toBeVisible()
    await page.keyboard.press('Escape')

    // A different agent, in the same session, reads it back.
    const snapshot = await (await page.request.get('/api/workspace/bootstrap')).json()
    const node = snapshot.graph.nodes.find((n: { title: string }) => n.title === 'Python')
    await page.request.put(`/api/workspace/nodes/${node.id}/backend`, { data: { agentId: second } })
    await page.reload()
    await send(page, 'mcp:recall_memory')
    await expect(page.getByTestId('center-region').getByText(/Knows list comprehensions/).last()).toBeVisible()
  })
})
