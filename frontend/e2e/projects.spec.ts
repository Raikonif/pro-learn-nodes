import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page } from '@playwright/test'

import { createProfile, expect, test } from './fixtures'

// A real ACP subprocess: it answers a prompt that is exactly `recall` with
// "previously: <earlier prompts joined by ' | '>", which is how this spec sees
// what the agent was actually told.
const FAKE_AGENT = fileURLToPath(new URL('../../backend/tests/fixtures/fake_acp_agent.py', import.meta.url))

type SnapshotNode = { id: string; title: string; projectId: string; archivedAt?: string | null }
type SnapshotProject = { id: string; name: string; isDefault: boolean; instructions: string }
type Snapshot = {
  graph: {
    nodes: SnapshotNode[]
    projects: SnapshotProject[]
    links: { id: string; parentId: string; childId: string }[]
    threads: { id: string; nodeId: string }[]
  }
}

async function bootstrap(page: Page): Promise<Snapshot> {
  const response = await page.request.get('/api/workspace/bootstrap')
  expect(response.ok()).toBe(true)
  return response.json()
}

async function nodeByTitle(page: Page, title: string): Promise<SnapshotNode> {
  const node = (await bootstrap(page)).graph.nodes.find((candidate) => candidate.title === title)
  expect(node, `a session titled ${title}`).toBeDefined()
  return node!
}

async function registerFakeAgent(page: Page): Promise<void> {
  const response = await page.request.post('/api/agents', {
    data: {
      name: 'Fake Agent',
      command: 'python3',
      args: [FAKE_AGENT, '--sessions-dir', join(tmpdir(), `ln-e2e-projects-${Date.now()}`)],
    },
  })
  expect(response.ok()).toBe(true)
  // Registered through the API, so the window's agent list is read again.
  await page.reload()
}

const rail = (page: Page) => page.getByTestId('left-rail')
const center = (page: Page) => page.getByTestId('center-region')

/** The management menu is collapsed by default; open it once. */
async function openManage(page: Page): Promise<void> {
  const toggle = rail(page).getByRole('button', { name: 'Manage', exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(rail(page).getByRole('group', { name: 'Manage projects' })).toBeVisible()
}

async function createProject(page: Page, name: string): Promise<void> {
  await openManage(page)
  await rail(page).getByRole('button', { name: 'New project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(rail(page).getByLabel('Project', { exact: true }).locator('option', { hasText: name })).toHaveCount(1)
}

/** The history's project filter; `All projects` clears it. */
async function filterTo(page: Page, label: string): Promise<void> {
  await rail(page).getByLabel('Project', { exact: true }).selectOption({ label })
}

/** Through the palette, which is the way to the detailed start once sessions exist. */
async function startSession(page: Page, topic: string, project?: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('Start with a topic')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Start a session' })
  await dialog.getByLabel('Topic').fill(topic)
  if (project) await dialog.getByLabel('Project', { exact: true }).selectOption({ label: project })
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(center(page).getByRole('heading', { name: topic })).toBeVisible()
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
}

/** Reads what the agent was told so far in the open session. */
async function recall(page: Page): Promise<string> {
  const before = await center(page).getByText(/^previously:/).count()
  await send(page, 'recall')
  const answers = center(page).getByText(/^previously:/)
  await expect(answers).toHaveCount(before + 1)
  return (await answers.last().textContent()) ?? ''
}

async function seedAgentMessage(page: Page, title: string, content: string): Promise<void> {
  const snapshot = await bootstrap(page)
  const node = snapshot.graph.nodes.find((candidate) => candidate.title === title)!
  const thread = snapshot.graph.threads.find((candidate) => candidate.nodeId === node.id)!
  const response = await page.request.post('/api/workspace/messages', {
    data: { threadId: thread.id, role: 'agent', content },
  })
  expect(response.ok()).toBe(true)
}

async function selectPhrase(page: Page, phrase: string): Promise<void> {
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

/**
 * The canvas is what the center shows when no session is open, and the window
 * reopens the last one — so the pointer is cleared before the reload. The
 * window saves that pointer itself whenever a session is opened, and a save
 * still in flight can land after ours, so the pair is retried until it holds.
 */
async function showCanvas(page: Page): Promise<void> {
  await expect(async () => {
    const cleared = await page.request.put('/api/workspace/context', { data: { lastOpenNodeId: null, viewport: {} } })
    expect(cleared.ok()).toBe(true)
    await page.reload()
    await expect(center(page).getByTestId('graph-canvas')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
}

test.describe('projects', () => {
  test('a project is created, filled, filtered, moved between, and crossed by a branch', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await createProfile(page, 'Projects Membership Spec')

    // The default project is there from the start; a new one joins it.
    const general = (await bootstrap(page)).graph.projects.find((project) => project.isDefault)!
    expect(general.name).toBe('General')
    await createProject(page, 'Calculus')
    const calculus = (await bootstrap(page)).graph.projects.find((project) => project.name === 'Calculus')!

    // The detailed start's picker puts a session in the project; without
    // touching it, a session lands in the default one.
    await startSession(page, 'Limits', 'Calculus')
    await startSession(page, 'Scratch')
    expect((await nodeByTitle(page, 'Limits')).projectId).toBe(calculus.id)
    expect((await nodeByTitle(page, 'Scratch')).projectId).toBe(general.id)

    // Showing every project, each entry names its own.
    const entry = (title: string) =>
      rail(page).getByTestId('session-entry').filter({ has: page.getByRole('button', { name: title, exact: true }) })
    await expect(entry('Limits').getByTestId('session-project')).toHaveText('Calculus')
    await expect(entry('Scratch').getByTestId('session-project')).toHaveText('General')

    // Filtering narrows the history to one project; All brings the rest back.
    await filterTo(page, 'Calculus')
    await expect(entry('Limits')).toHaveCount(1)
    await expect(entry('Scratch')).toHaveCount(0)
    await filterTo(page, 'General')
    await expect(entry('Scratch')).toHaveCount(1)
    await expect(entry('Limits')).toHaveCount(0)
    await filterTo(page, 'All projects')
    await expect(rail(page).getByTestId('session-entry')).toHaveCount(2)

    // Moving a session changes its project and nothing else.
    await entry('Scratch').getByRole('button', { name: 'Move Scratch to a project' }).click()
    await rail(page).getByRole('button', { name: 'Move Scratch to Calculus' }).click()
    await expect(entry('Scratch').getByTestId('session-project')).toHaveText('Calculus')
    expect((await nodeByTitle(page, 'Scratch')).projectId).toBe(calculus.id)
    await filterTo(page, 'General')
    await expect(rail(page).getByText('No sessions in this project yet.')).toBeVisible()
    await filterTo(page, 'All projects')

    // A branch starts in its source's project; moving the child out leaves the
    // link in place, now crossing from one project to another.
    await seedAgentMessage(page, 'Limits', 'Epsilon delta arguments make limits precise.')
    await page.reload()
    await rail(page).getByRole('button', { name: 'Limits', exact: true }).click()
    await expect(center(page).getByText('Epsilon delta arguments make limits precise.')).toBeVisible()
    await selectPhrase(page, 'Epsilon delta arguments')
    await page.getByRole('button', { name: /generate node/i }).click()
    await expect(rail(page).getByRole('button', { name: 'Epsilon delta arguments', exact: true })).toBeVisible()
    const inherited = await nodeByTitle(page, 'Epsilon delta arguments')
    expect(inherited.projectId).toBe(calculus.id)

    await entry('Epsilon delta arguments').getByRole('button', { name: /^Move Epsilon delta arguments to a project$/ }).click()
    await rail(page).getByRole('button', { name: 'Move Epsilon delta arguments to General' }).click()
    await expect(entry('Epsilon delta arguments').getByTestId('session-project')).toHaveText('General')

    const snapshot = await bootstrap(page)
    const source = snapshot.graph.nodes.find((node) => node.title === 'Limits')!
    const child = snapshot.graph.nodes.find((node) => node.title === 'Epsilon delta arguments')!
    expect(snapshot.graph.links.some((link) => link.parentId === source.id && link.childId === child.id)).toBe(true)
    expect(source.projectId).toBe(calculus.id)
    expect(child.projectId).toBe(general.id)

    // On the canvas each project is a labelled region, and the cards stay.
    await showCanvas(page)
    const regions = center(page).getByTestId('project-region-label')
    await expect(regions.filter({ hasText: 'Calculus' })).toHaveCount(1)
    await expect(regions.filter({ hasText: 'General' })).toHaveCount(1)
    await expect(center(page).getByTestId('graph-node-card')).toHaveCount(3)
  })

  test('project instructions reach the agent once, and again only when they change', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await createProfile(page, 'Projects Instructions Spec')
    await registerFakeAgent(page)
    await createProject(page, 'Tutor')
    await filterTo(page, 'Tutor')

    await openManage(page)
    await rail(page).getByRole('button', { name: 'Edit instructions of Tutor' }).click()
    const editor = page.getByRole('dialog', { name: 'Instructions for Tutor' })
    await editor.getByLabel('Instructions').fill('Always answer in one short sentence.')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor).toHaveCount(0)

    // The picker preselects the project the history is looking at.
    await startSession(page, 'Grammar', 'Tutor')
    await expect(center(page).getByTestId('session-project-link')).toHaveText('Tutor')
    await send(page, 'First question')
    const first = await recall(page)
    expect(first).toContain('Project "Tutor" instructions:')
    expect(first).toContain('Always answer in one short sentence.')

    // Edited instructions ride along with the next turn, and only that turn.
    await center(page).getByTestId('session-project-link').click()
    const reopened = page.getByRole('dialog', { name: 'Instructions for Tutor' })
    await expect(reopened.getByLabel('Instructions')).toHaveValue('Always answer in one short sentence.')
    await reopened.getByLabel('Instructions').fill('Always answer in French.')
    await reopened.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(reopened).toHaveCount(0)

    await send(page, 'Second question')
    await send(page, 'Third question')
    const later = await recall(page)
    expect(later.split('The project for this session is now "Tutor"')).toHaveLength(2)
    expect(later).toContain('Always answer in French.')
    expect(later.split('Project "Tutor" instructions:')).toHaveLength(2)
  })

  test('archiving a project is exactly undone, and deleting one keeps its sessions', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await createProfile(page, 'Projects Archive Spec')
    await createProject(page, 'Seasonal')
    await startSession(page, 'Kept whole', 'Seasonal')
    await startSession(page, 'Archived early', 'Seasonal')
    await startSession(page, 'Outside')
    const entry = (title: string) => rail(page).getByRole('button', { name: title, exact: true })

    // One session is archived on its own before the project goes.
    await rail(page).getByRole('button', { name: 'Archive Archived early' }).click()
    await expect(entry('Archived early')).toHaveCount(0)

    await filterTo(page, 'Seasonal')
    await openManage(page)
    await rail(page).getByRole('button', { name: 'Archive project Seasonal' }).click()

    // Its session leaves the history and the canvas; the others stay.
    await filterTo(page, 'All projects')
    await expect(entry('Kept whole')).toHaveCount(0)
    await expect(entry('Outside')).toBeVisible()
    await showCanvas(page)
    await expect(center(page).getByTestId('graph-node-card')).toHaveCount(1)
    await expect(center(page).getByTestId('project-region-label').filter({ hasText: 'Seasonal' })).toHaveCount(0)
    expect((await bootstrap(page)).graph.projects.map((project) => project.name)).not.toContain('Seasonal')

    // It is listed among the archived projects, with what it holds.
    await openManage(page)
    await rail(page).getByRole('button', { name: 'Archived projects', exact: true }).click()
    const archived = rail(page).getByTestId('archived-project')
    await expect(archived).toHaveCount(1)
    await expect(archived).toContainText('Seasonal')

    // A session archived on its own stays out while its project is archived.
    const search = rail(page).getByRole('searchbox', { name: 'Search sessions' })
    await search.fill('Archived early')
    await rail(page).getByLabel('Include archived').check()
    await rail(page).getByRole('button', { name: 'Restore Archived early' }).click()
    await expect(rail(page).getByRole('alert').filter({ hasText: 'Restore the project Seasonal first' })).toBeVisible()
    await search.fill('')

    // Restoring the project brings back exactly what it took.
    await rail(page).getByRole('button', { name: 'Restore project Seasonal' }).click()
    await expect(entry('Kept whole')).toBeVisible()
    await expect(entry('Archived early')).toHaveCount(0)
    await expect(archived).toHaveCount(0)
    const restored = await bootstrap(page)
    expect(restored.graph.projects.map((project) => project.name)).toContain('Seasonal')
    expect(restored.graph.nodes.map((node) => node.title)).not.toContain('Archived early')

    // Deleting the project moves its sessions to the default one; none is lost.
    await filterTo(page, 'Seasonal')
    await rail(page).getByRole('button', { name: 'Delete project Seasonal' }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete Seasonal?' })
    await expect(confirmation).toContainText('No session is deleted')
    await confirmation.getByRole('button', { name: 'Delete project' }).click()
    await expect(confirmation).toHaveCount(0)

    await filterTo(page, 'All projects')
    const after = await bootstrap(page)
    const general = after.graph.projects.find((project) => project.isDefault)!
    expect(after.graph.projects.map((project) => project.name)).not.toContain('Seasonal')
    expect(after.graph.nodes.find((node) => node.title === 'Kept whole')!.projectId).toBe(general.id)
    await expect(entry('Kept whole')).toBeVisible()
    await expect(rail(page).getByTestId('session-entry').filter({ hasText: 'Kept whole' }).getByTestId('session-project')).toHaveText('General')

    // The one archived on its own is still there to restore, now in General.
    await search.fill('Archived early')
    await rail(page).getByLabel('Include archived').check()
    await rail(page).getByRole('button', { name: 'Restore Archived early' }).click()
    await search.fill('')
    await expect(entry('Archived early')).toBeVisible()
    expect((await nodeByTitle(page, 'Archived early')).projectId).toBe(general.id)
  })
})
