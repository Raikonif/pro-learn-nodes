import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

const FAKE_AGENT = fileURLToPath(new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url))
const PARENT = 'Recursion'
const PASSAGE = 'structural recursion on lists'

async function selectPhrase(page: Page, phrase: string) {
  await page.evaluate((needle) => {
    const host = document.querySelector('[data-testid="center-region"]')!
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.textContent?.includes(needle)) node = walker.nextNode()
    const start = node!.textContent!.indexOf(needle)
    const range = document.createRange()
    range.setStart(node!, start)
    range.setEnd(node!, start + needle.length)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    node!.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, phrase)
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
}

test('a branch starts knowing its parent up to the passage, and leads back to it', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await createProfile(page, 'Branch Inheritance Spec')
  await page.request.post('/api/agents', {
    data: { name: 'Fake Agent', command: 'python3', args: [FAKE_AGENT, '--sessions-dir', join(tmpdir(), `ln-e2e-branch-${Date.now()}`)] },
  })
  const created = await (await page.request.post('/api/workspace/nodes', { data: { title: PARENT } })).json()
  const parent = created.graph.nodes.find((n: { title: string }) => n.title === PARENT)
  const thread = created.graph.threads.find((t: { nodeId: string }) => t.nodeId === parent.id)
  await page.request.post('/api/workspace/messages', { data: { threadId: thread.id, role: 'agent', content: `Folds are ${PASSAGE}.` } })
  await page.request.post('/api/workspace/messages', { data: { threadId: thread.id, role: 'agent', content: 'A later remark the branch must not see.' } })
  await page.reload()
  const center = page.getByTestId('center-region')
  await center.getByRole('button', { name: PARENT, exact: true }).click()
  await expect(center.getByText(`Folds are ${PASSAGE}.`)).toBeVisible()

  await selectPhrase(page, PASSAGE)
  await page.getByRole('button', { name: /generate node/i }).click()
  await page.getByTestId('left-rail').getByRole('button', { name: PASSAGE, exact: true }).click()

  // The child starts empty and says where it came from.
  const origin = center.getByTestId('branch-origin')
  await expect(origin).toContainText(`Branched from ${PARENT}`)
  await expect(origin).toContainText(PASSAGE)

  // Its agent was given the parent up to the passage — and nothing after it.
  await send(page, 'Go deeper')
  await send(page, 'recall')
  const recalled = center.getByText(/^previously:/).last()
  await expect(recalled).toContainText(`Folds are ${PASSAGE}.`)
  await expect(recalled).toContainText('The learner branched from this passage')
  await expect(recalled).not.toContainText('A later remark')

  // The origin leads back to the parent, at the passage.
  await origin.getByRole('button').click()
  await expect(center.getByRole('heading', { name: PARENT })).toBeVisible()
  await expect(center.locator('[data-highlighted="true"]')).toContainText(PASSAGE)
})
