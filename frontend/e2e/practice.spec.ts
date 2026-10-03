import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// Every test starts a fresh local profile, so its sessions and practice are
// its own and a rerun starts from nothing.

async function newSession(page: Page, title: string): Promise<void> {
  await page.getByTestId('center-region').getByRole('button', { name: 'Start with a topic…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Start a session' })
  await dialog.getByLabel('Topic').fill(title)
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByTestId('center-region').getByRole('heading', { name: title })).toBeVisible()
}

function practice(page: Page) {
  return page.getByTestId('practice-rail')
}

/** Chooses an entry of the workbench's add control. */
async function add(page: Page, entry: string): Promise<void> {
  await practice(page).getByRole('button', { name: '+ Add' }).click()
  await page.getByRole('menuitem', { name: entry }).click()
}

/** Expands a block by its header (its accessible name starts `<Kind>: <title>`). */
async function expand(page: Page, header: RegExp): Promise<void> {
  const button = practice(page).getByRole('button', { name: header })
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
}

test.describe('practice', () => {
  test('a program runs, and a runaway one can be stopped while the app stays responsive', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await createProfile(page, 'Practice Sandbox Spec')
    await newSession(page, 'Loops')
    await add(page, 'Open scratch code')
    const code = page.getByLabel('Python code')
    const result = page.getByRole('region', { name: 'Run result' })

    // The first run also loads Python from the app's own bundle.
    await code.fill('print("hello from the sandbox")')
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(result).toContainText('hello from the sandbox', { timeout: 60_000 })

    await code.fill('print("before the loop")\nwhile True:\n    pass')
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    // Every run gets a fresh interpreter, so this one may first wait for the
    // replacement to load. Its first line arriving while the loop still runs
    // is what shows output streams rather than waiting for the end.
    await expect(result).toContainText('before the loop', { timeout: 60_000 })
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()

    // The conversation stays usable while the loop runs.
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('still responsive')
    await expect(composer).toHaveValue('still responsive')

    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(result).toContainText('Stopped by you.')
    await expect(result).toContainText('before the loop')
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  })

  test('a question and its answers survive a restart, and answering again keeps the first', async ({ page }) => {
    await page.goto('/')
    await createProfile(page, 'Practice Questions Spec')
    await newSession(page, 'Folds')
    // Writing a question from the add control opens the learner's own block
    // with its form already open.
    await add(page, 'Write a question')
    const form = page.getByRole('form', { name: 'New question' })
    await form.getByLabel('Question', { exact: true }).fill('What does a fold do?')
    await form.getByRole('button', { name: 'Add question' }).click()
    await expect(page.getByText('What does a fold do?')).toBeVisible()

    await page.getByLabel('Your answer').fill('It reduces a structure')
    await page.getByRole('button', { name: 'Submit answer' }).click()
    await expect(page.getByText('Your latest answer · 1 attempt')).toBeVisible()

    // A restart: the page reloads and reads everything back from the backend.
    // The block is still the expanded one: the arrangement is kept on this device.
    await page.reload()
    await expect(practice(page).getByRole('button', { name: /^Q&A: Your questions/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(page.getByText('What does a fold do?')).toBeVisible()
    await expect(page.getByText('It reduces a structure')).toBeVisible()

    await page.getByLabel('Answer again').fill('It combines elements with a function')
    await page.getByRole('button', { name: 'Submit answer' }).click()
    await expect(page.getByText('Your latest answer · 2 attempts')).toBeVisible()
    await expect(page.getByText('It combines elements with a function')).toBeVisible()

    const stored = await page.request.get('/api/workspace/bootstrap')
    const nodeId = (await stored.json()).graph.nodes.find((n: { title: string }) => n.title === 'Folds').id
    const material = await (await page.request.get(`/api/practice/nodes/${nodeId}`)).json()
    expect(material.attempts.map((a: { response: string }) => a.response)).toEqual([
      'It combines elements with a function',
      'It reduces a structure',
    ])
  })

  test('a branch starts with no practice and leaves the source untouched', async ({ page }) => {
    await page.goto('/')
    await createProfile(page, 'Practice Branch Spec')
    await newSession(page, 'Source')
    const snapshot = await (await page.request.get('/api/workspace/bootstrap')).json()
    const source = snapshot.graph.nodes.find((n: { title: string }) => n.title === 'Source')
    const thread = snapshot.graph.threads.find((t: { nodeId: string }) => t.nodeId === source.id)
    await page.request.post('/api/workspace/messages', {
      data: { threadId: thread.id, role: 'agent', content: 'Recursion schemes generalise folds.' },
    })
    await page.request.put(`/api/practice/nodes/${source.id}/sandbox`, { data: { code: 'print("source code")' } })
    await page.request.post(`/api/practice/nodes/${source.id}/items`, {
      data: { kind: 'free_response', prompt: 'Source question?' },
    })
    await page.reload()

    // Branch from a passage of the source's conversation.
    // Scoped: the history's preview of the session repeats the same text.
    await expect(page.getByTestId('center-region').getByText('Recursion schemes generalise folds.')).toBeVisible()
    await page.evaluate(() => {
      const host = document.querySelector('[data-testid="center-region"]')!
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && !node.textContent?.includes('Recursion schemes')) node = walker.nextNode()
      const range = document.createRange()
      const start = node!.textContent!.indexOf('Recursion schemes')
      range.setStart(node!, start)
      range.setEnd(node!, start + 'Recursion schemes'.length)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      node!.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await page.getByRole('button', { name: /generate node/i }).click()
    await expect(
      page.getByTestId('left-rail').getByRole('button', { name: 'Recursion schemes', exact: true }),
    ).toBeVisible()
    await page.getByTestId('left-rail').getByRole('button', { name: 'Recursion schemes', exact: true }).click()

    // The branch's workbench is empty: none of the source's practice came along.
    await expect(practice(page).getByTestId('workbench-empty')).toBeVisible()
    await expect(page.getByText('Source question?')).toHaveCount(0)
    await add(page, 'Open scratch code')
    await expect(page.getByLabel('Python code')).toHaveValue('')

    await page.getByTestId('left-rail').getByRole('button', { name: 'Source', exact: true }).click()
    // Wait for Source's own workbench before reading which block is expanded.
    await expect(page.getByTestId('center-region').getByRole('heading', { name: 'Source' })).toBeVisible()
    await expect(practice(page).getByTestId('practice-block')).toHaveCount(2)
    await expand(page, /^Scratch: Scratch code/)
    await expect(page.getByLabel('Python code')).toHaveValue('print("source code")')
    await expand(page, /^Q&A: Your questions/)
    await expect(page.getByText('Source question?')).toBeVisible()
  })
})
