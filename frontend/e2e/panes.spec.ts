import type { Locator, Page } from '@playwright/test'

import { expect, launchSignedIn, test } from './fixtures'

// One name for this file, distinct from the accounts other specs use.
const ACCOUNT = 'Panes Spec'
const STORAGE_KEY = 'learn-nodes.pane-layout'

async function width(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no box')
  return Math.round(box.width)
}

/** Waits for the debounced write so a reload reads what was just arranged. */
async function waitForStoredRightWidth(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    ([key, want]) => {
      const raw = window.localStorage.getItem(key)
      return raw !== null && (JSON.parse(raw) as { right?: { width?: number } }).right?.width === want
    },
    [STORAGE_KEY, expected] as const,
  )
}

test.describe('Resizable workspace panes', () => {
  test('dragging the right rail wider survives a reload', async ({ page }) => {
    await launchSignedIn(page, ACCOUNT)
    const right = page.getByTestId('right-rail')
    const before = await width(right)

    const edge = page.getByRole('separator', { name: 'Resize workspace tools' })
    const box = await edge.boundingBox()
    if (!box) throw new Error('resize edge has no box')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // Several steps, as a real drag would report.
    await page.mouse.move(x - 50, y, { steps: 5 })
    await page.mouse.move(x - 100, y, { steps: 5 })
    await page.mouse.up()

    await expect.poll(() => width(right)).toBe(before + 100)
    await waitForStoredRightWidth(page, before + 100)

    await page.reload()
    await expect(page.getByTestId('left-rail')).toBeVisible()
    await expect.poll(() => width(page.getByTestId('right-rail'))).toBe(before + 100)
  })

  test('collapsing the left rail widens the conversation, expanding restores it', async ({ page }) => {
    await launchSignedIn(page, ACCOUNT)
    const left = page.getByTestId('left-rail')
    const center = page.getByTestId('center-region')
    const leftBefore = await width(left)
    const centerBefore = await width(center)

    await page.getByRole('button', { name: 'Collapse node index' }).click()

    await expect(left).toBeHidden()
    await expect(page.getByRole('button', { name: 'Show node index' })).toBeVisible()
    await expect.poll(() => width(center)).toBeGreaterThan(centerBefore + 100)

    await page.getByRole('button', { name: 'Expand node index' }).click()

    await expect(left).toBeVisible()
    await expect.poll(() => width(left)).toBe(leftBefore)
    await expect.poll(() => width(center)).toBe(centerBefore)
  })

  test('at 800x600 the center keeps its minimum, even with wide rails stored', async ({ page }) => {
    await launchSignedIn(page, ACCOUNT)
    await page.evaluate((key) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ left: { width: 420, collapsed: false }, right: { width: 600, collapsed: false } }),
      )
    }, STORAGE_KEY)

    await page.setViewportSize({ width: 800, height: 600 })
    await page.reload()

    const left = page.getByTestId('left-rail')
    const center = page.getByTestId('center-region')
    const right = page.getByTestId('right-rail')
    await expect(left).toBeVisible()
    await expect(center).toBeVisible()
    await expect(right).toBeVisible()
    expect(await width(center)).toBeGreaterThanOrEqual(380)
    expect(await width(left)).toBe(180)
    expect(await width(right)).toBe(240)

    // The stored intent is untouched: widening the window brings it back.
    await page.setViewportSize({ width: 1600, height: 900 })
    await expect.poll(() => width(left)).toBe(420)
    await expect.poll(() => width(right)).toBe(600)
  })

  test('the keyboard resizes a rail', async ({ page }) => {
    await launchSignedIn(page, ACCOUNT)
    const right = page.getByTestId('right-rail')
    const before = await width(right)

    const edge = page.getByRole('separator', { name: 'Resize workspace tools' })
    await edge.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => width(right)).toBe(before + 16)
    await expect(edge).toHaveAttribute('aria-valuenow', String(before + 16))

    await page.keyboard.press('Shift+ArrowLeft')
    await expect.poll(() => width(right)).toBe(before + 80)

    await edge.dblclick()
    await expect.poll(() => width(right)).toBe(320)
  })
})
