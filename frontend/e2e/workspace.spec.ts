import { type Page } from '@playwright/test'

import { expect, signIn, test } from './fixtures'

// This file's own account, distinct from every other spec's, so its durable
// data cannot be mistaken for — or collide with — theirs.
const ACCOUNT = 'Workspace Spec'
const ROOT_TITLE = 'Local Persistence'
const MESSAGE = 'A durable workspace keeps each selected passage available after restart.'

async function selectPhrase(page: Page, phrase: string) {
  await page.evaluate((needle) => {
    const host = document.querySelector('[data-testid="center-region"]')
    if (!host) throw new Error('center region not found')
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    let node: Node | null = walker.nextNode()
    while (node) {
      const index = node.textContent?.indexOf(needle) ?? -1
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + needle.length)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        node.parentElement?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return
      }
      node = walker.nextNode()
    }
    throw new Error(`phrase not found in center region: ${needle}`)
  }, phrase)
}

/**
 * Test data enters through the same durable API the app uses, never fixtures.
 *
 * Requires an active account: these routes take their workspace from the
 * session and refuse outright while signed out, so this runs after sign-in
 * and lands in whichever account signed in.
 */
async function ensureWorkspaceData(page: Page): Promise<void> {
  let snapshot = await (await page.request.get('/api/workspace/bootstrap')).json()
  let root = snapshot.graph.nodes.find((node: { title: string }) => node.title === ROOT_TITLE)
  if (!root) {
    snapshot = await (
      await page.request.post('/api/workspace/nodes', {
        data: { title: ROOT_TITLE, mode: 'Explore' },
      })
    ).json()
    root = snapshot.graph.nodes.find((node: { title: string }) => node.title === ROOT_TITLE)
  }
  const main = snapshot.graph.threads.find(
    (thread: { nodeId: string; anchor: unknown }) => thread.nodeId === root.id && thread.anchor === null,
  )
  if (!snapshot.graph.messages.some((message: { threadId: string }) => message.threadId === main.id)) {
    snapshot = await (
      await page.request.post('/api/workspace/messages', {
      data: { threadId: main.id, role: 'agent', content: MESSAGE },
      })
    ).json()
  }
  await page.request.put('/api/workspace/context', {
    data: { lastOpenNodeId: null, viewport: {} },
  })
}

test.describe.configure({ mode: 'serial' })
test.describe('workspace', () => {
  test.beforeEach(async ({ page }) => {
    // Sign-in comes first: the seeding below is scoped to the active account,
    // and the root view is the sign-in surface until there is one.
    await page.goto('/')
    await signIn(page, ACCOUNT)
    await ensureWorkspaceData(page)
    // The snapshot hydrated at sign-in predates the seeding.
    await page.reload()
    await expect(page.getByTestId('left-rail')).toBeVisible()
  })

  test('hydrates a durable workspace with all three panes visible', async ({ page }) => {
    await expect(page.getByTestId('center-region')).toBeVisible()
    await expect(page.getByTestId('right-rail')).toBeVisible()
    await expect(
      page.getByTestId('center-region').getByRole('button', { name: ROOT_TITLE, exact: true }),
    ).toBeVisible()
  })

  test('persists node navigation through the backend context', async ({ page }) => {
    const center = page.getByTestId('center-region')
    await center.getByRole('button', { name: ROOT_TITLE, exact: true }).click()
    await expect(center.getByText(MESSAGE)).toBeVisible()
    await expect(page.getByTestId('right-rail-map')).toBeVisible()
  })

  test('creates and opens a durable child from a card plus control', async ({ page }) => {
    const center = page.getByTestId('center-region')
    await center.getByRole('button', { name: `Create child node from ${ROOT_TITLE}` }).click()
    await expect(center.getByRole('heading', { name: `New child of ${ROOT_TITLE}` })).toBeVisible()
    await expect(
      // Exact: each history entry also carries "Rename …" and "Archive …".
      page.getByTestId('left-rail').getByRole('button', { name: `New child of ${ROOT_TITLE}`, exact: true }),
    ).toBeVisible()
  })

  test('persists a selection branch without changing the source graph until the response arrives', async ({ page }) => {
    const center = page.getByTestId('center-region')
    await center.getByRole('button', { name: ROOT_TITLE, exact: true }).click()
    await expect(center.getByText(MESSAGE)).toBeVisible()

    await selectPhrase(page, 'durable workspace')
    await page.getByRole('button', { name: /generate node/i }).click()

    await expect(
      // The branch is titled with the selected passage; exact, since each
      // history entry also carries "Rename …" and "Archive …".
      page.getByTestId('left-rail').getByRole('button', { name: 'durable workspace', exact: true }),
    ).toBeVisible()
  })

  test('creates a durable side thread without adding a graph node', async ({ page }) => {
    const center = page.getByTestId('center-region')
    await center.getByRole('button', { name: ROOT_TITLE, exact: true }).click()
    const nodeCountBefore = await page.getByTestId('left-rail').getByRole('button').count()

    await expect(center.getByText(MESSAGE)).toBeVisible()
    await selectPhrase(page, 'durable workspace')
    await page.getByRole('button', { name: /new chat/i }).click()

    await expect(center.getByText(/durable workspace/i).first()).toBeVisible()
    await expect(page.getByTestId('left-rail').getByRole('button')).toHaveCount(nodeCountBefore)
  })

  test('remains usable at 800x600 after bootstrap', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    await page.goto('/')
    const center = page.getByTestId('center-region')
    await expect(page.getByTestId('left-rail')).toBeVisible()
    await expect(center).toBeVisible()
    await expect(page.getByTestId('right-rail')).toBeVisible()
    await expect(center.getByTestId('rf__controls')).toBeVisible()
  })
})
