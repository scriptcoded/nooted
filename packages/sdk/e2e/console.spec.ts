import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { consoleContextAs, listItems, readProject } from './helpers.ts'
import { insertLegacyItem, sendRealReport } from './console-helpers.ts'
import { ADMIN_EMAIL, NOOTED_URL, PLAYGROUND_PORT, STORAGE_STATE } from './env.ts'

// The console, served by the e2e server, against reports sent through the real SDK.

test.describe.configure({ mode: 'serial' })

let itemId = ''
let legacyId = ''
let admin: BrowserContext
const projectUrl = () => `${NOOTED_URL}/projects/${readProject().id}`
const detailUrl = (id: string) => `${projectUrl()}/feedback/${id}`

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  itemId = await sendRealReport(page)
  await context.close()
  legacyId = insertLegacyItem()
  admin = await browser.newContext({
    storageState: STORAGE_STATE,
    baseURL: NOOTED_URL,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
})

test.afterAll(async () => {
  await admin?.close()
})

const card = (page: Page, n: number) => page.locator(`#capture-${n}`)

test('the report reached the server with three captures', async () => {
  const items = await listItems()
  expect(items.find((i) => i.id === itemId)).toMatchObject({ captureCount: 3 })
})

test('the list shows the capture count and note chips, and loads no events or replay code', async () => {
  const page = await admin.newPage()
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.goto(projectUrl())
  const row = page.getByTestId('feedback-row').filter({ hasText: 'should confirm' })
  await expect(row).toHaveCount(1)
  await expect(row.getByTestId('capture-count')).toHaveText('3')
  await expect(row.getByTestId('note-ref')).toHaveText(['1', '2', '3'])
  await expect(row.getByTestId('note-ref').first()).toHaveAttribute('data-ref', '1')
  // The legacy row shows a dash instead of a count.
  await expect(page.getByTestId('feedback-row').filter({ hasText: 'Old report' }).getByTestId('capture-count')).toHaveText('—')
  await page.waitForLoadState('networkidle')
  expect(requests.filter((u) => /\/captures\/\d+\/events/.test(u) || /replay-[^/]*\.js/.test(u))).toEqual([])
  await page.close()
})

test('clicking a row opens the item', async () => {
  const page = await admin.newPage()
  await page.goto(projectUrl())
  // The reporter cell: the middle of the row may be the page link, which opens the page itself.
  await page.getByTestId('feedback-row').filter({ hasText: 'should confirm' }).getByRole('cell').nth(2).click()
  await expect(page).toHaveURL(detailUrl(itemId))
  await expect(page.getByTestId('feedback-note')).toContainText('should confirm')
  await page.close()
})

test.describe('the item page', () => {
  let page: Page
  test.beforeAll(async () => {
    page = await admin.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(detailUrl(itemId))
    await expect(page.getByTestId('capture-card')).toHaveCount(3)
  })
  test.afterAll(async () => {
    await page.close()
  })

  test('metadata shows the reporter, page, device and viewport', async () => {
    const meta = page.getByTestId('feedback-meta')
    await expect(meta).toContainText(ADMIN_EMAIL)
    await expect(meta.getByRole('link', { name: new RegExp(`localhost:${PLAYGROUND_PORT}`) })).toBeVisible()
    await expect(meta).toContainText('Chrome')
    await expect(meta).toContainText(/\d+×\d+ @/)
  })

  test('capture 1 lists the counter button with name, role and selector, and copies the selector', async () => {
    const element = card(page, 1).getByTestId('capture-element')
    await expect(element).toHaveCount(1)
    await expect(element).toContainText('Add to cart')
    await expect(element).toContainText('button')
    await expect(element.getByTestId('capture-selector')).toContainText('fx-counter')
    await element.getByRole('button', { name: 'Copy selector' }).click()
    await expect(page.getByText('Selector copied')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('fx-counter')
  })

  test('capture 1 thumbnail renders and frames the selected element in the middle of the tile', async () => {
    const thumb = card(page, 1).getByTestId('capture-thumb')
    await expect(thumb).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
    const mark = thumb.getByTestId('capture-mark')
    await expect(mark).toHaveCount(1)
    const [t, m] = await Promise.all([thumb.boundingBox(), mark.boundingBox()])
    expect(m!.x).toBeGreaterThanOrEqual(t!.x - 1)
    expect(m!.y).toBeGreaterThanOrEqual(t!.y - 1)
    expect(m!.x + m!.width).toBeLessThanOrEqual(t!.x + t!.width + 1)
    expect(m!.y + m!.height).toBeLessThanOrEqual(t!.y + t!.height + 1)
    const dx = m!.x + m!.width / 2 - (t!.x + t!.width / 2)
    const dy = m!.y + m!.height / 2 - (t!.y + t!.height / 2)
    expect(Math.abs(dx)).toBeLessThan(t!.width * 0.2)
    expect(Math.abs(dy)).toBeLessThan(t!.height * 0.2)
  })

  test('capture 2 is a recording with a duration, capture 3 is the whole page', async () => {
    await expect(card(page, 2)).toContainText(/Recording · 0:0\d/)
    await expect(card(page, 2).getByTestId('capture-duration')).toBeVisible()
    await expect(card(page, 3)).toContainText('Whole page')
    await expect(card(page, 3).getByTestId('capture-mark')).toHaveCount(0)
  })

  test('note references scroll to and highlight their capture', async () => {
    await page.getByTestId('feedback-note').getByTestId('note-ref').nth(1).click()
    await expect(card(page, 2)).toHaveAttribute('data-highlighted', 'true')
    await expect(card(page, 2)).toBeInViewport({ ratio: 0.5 })
    await expect(card(page, 1)).not.toHaveAttribute('data-highlighted', 'true')
    await expect(card(page, 2)).not.toHaveAttribute('data-highlighted', 'true', { timeout: 5_000 })
  })

  test('the large view opens, toggles the zoom, and closes', async () => {
    await card(page, 1).getByTestId('capture-open').click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toContainText(/^\s*1\s*Pointed at/)
    await expect(dlg.getByTestId('capture-large')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
    await expect(dlg.getByTestId('capture-mark')).toHaveCount(1)
    await dlg.getByRole('button', { name: 'Show whole page' }).click()
    await expect(dlg.getByRole('button', { name: 'Zoom to selection' })).toBeVisible()
    await expect(dlg.getByTestId('capture-large')).toHaveAttribute('data-ready', 'true')
    await dlg.getByRole('button', { name: 'Zoom to selection' }).click()
    await expect(dlg.getByRole('button', { name: 'Show whole page' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('the recording plays and returns to Play at the end', async () => {
    await card(page, 2).getByTestId('capture-open').click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByTestId('capture-large')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
    await expect(dlg.getByRole('button', { name: 'Show whole page' })).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Play' }).click()
    await expect(dlg.getByRole('button', { name: 'Pause' })).toBeVisible()
    // The clip is about a second long.
    await expect(dlg.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 15_000 })
    await dlg.getByRole('button', { name: 'Close' }).click()
  })

  test('a whole-page capture opens without a zoom toggle', async () => {
    await card(page, 3).getByTestId('capture-open').click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toContainText('Pointed at the whole page')
    await expect(dlg.getByTestId('capture-large')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
    await expect(dlg.getByRole('button', { name: /Show whole page|Zoom to selection/ })).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Close' }).click()
  })
})

test('a legacy item shows the notice and no captures', async () => {
  const page = await admin.newPage()
  await page.goto(detailUrl(legacyId))
  await expect(page.getByTestId('feedback-note')).toContainText('Old report')
  await expect(page.getByText('sent by an older SDK')).toBeVisible()
  await expect(page.getByTestId('capture-card')).toHaveCount(0)
  await expect(page.getByTestId('feedback-meta')).toContainText('1280×720')
  await page.close()
})

test('an unknown item shows "Feedback not found"', async () => {
  const page = await admin.newPage()
  await page.goto(detailUrl('00000000-0000-4000-8000-000000000000'))
  await expect(page.getByText('Feedback not found')).toBeVisible()
  await expect(page.getByTestId('capture-card')).toHaveCount(0)
  await page.close()
})

test('a signed-in non-member sees nothing of the item', async ({ browser }) => {
  const context = await consoleContextAs(browser, 'dev@example.com')
  try {
    const page = await context.newPage()
    const requests: string[] = []
    page.on('request', (r) => requests.push(r.url()))
    await page.goto(detailUrl(itemId))
    // The project itself is hidden from non-members, so its page answers before the item does.
    await expect(page.getByText(/not found/)).toBeVisible()
    await expect(page.getByTestId('capture-card')).toHaveCount(0)
    await expect(page.getByTestId('feedback-note')).toHaveCount(0)
    expect(requests.filter((u) => /\/captures\//.test(u))).toEqual([])
    // The API says the same.
    const { id } = readProject()
    expect((await context.request.get(`${NOOTED_URL}/api/projects/${id}/feedback/${itemId}`)).status()).toBe(404)
    expect((await context.request.get(`${NOOTED_URL}/api/projects/${id}/feedback/${itemId}/captures/1/events`)).status()).toBe(404)
  } finally {
    await context.close()
  }
})
