import { expect, test, type Page } from '@playwright/test'
import {
  captureReports,
  debugNooted,
  enableNooted,
  fulfillStatus,
  interceptReports,
  seedRealToken,
  signInThroughPopup,
  waitForRuntime,
} from './helpers.ts'

const host = (page: Page) => page.locator('#nooted-host')
const fab = (page: Page) => host(page).getByRole('button', { name: 'Report a problem' })
const note = (page: Page) => host(page).getByRole('textbox', { name: 'What went wrong?' })
const send = (page: Page) => host(page).getByRole('button', { name: 'Send', exact: true })
const startHandle = (page: Page) => host(page).getByRole('slider', { name: 'Focus start' })
const endHandle = (page: Page) => host(page).getByRole('slider', { name: 'Focus end' })
const toggle = (page: Page) => host(page).getByRole('switch', { name: /Include recording/ })
const reviewButton = (page: Page) => host(page).getByRole('button', { name: 'Review recording' })
const doneButton = (page: Page) => host(page).getByRole('button', { name: 'Done', exact: true })
const resetButton = (page: Page) => host(page).getByRole('button', { name: 'Reset', exact: true })
const summary = (page: Page) => host(page).locator('.review-summary')
const signInButton = (page: Page) => host(page).getByRole('button', { name: 'Sign in to Nooted' })

test.beforeEach(async ({ page }) => {
  await debugNooted(page)
  await enableNooted(page)
  await seedRealToken(page)
})

/** Loads the page, lets the recording grow past a second, optionally throws an error, then opens the window. */
async function open(page: Page, opts: { error?: boolean } = {}): Promise<{ errorAt?: number }> {
  await page.goto('/')
  await waitForRuntime(page)
  await page.locator('a[data-route="/checkout"]').click()
  await page.waitForTimeout(1500)
  let errorAt: number | undefined
  if (opts.error) {
    const before = Date.now()
    await page.locator('#throw-error').click()
    errorAt = (before + Date.now()) / 2
    await page.waitForTimeout(1200)
  }
  await fab(page).click()
  await expect(note(page)).toBeVisible()
  return { errorAt }
}

/** Opens the review view (the timeline lives there). */
async function review(page: Page): Promise<void> {
  await reviewButton(page).click()
  await expect(startHandle(page)).toBeVisible()
}

const isError = (e: { type: number; data?: unknown }) => e.type === 5 && (e.data as { tag?: string } | undefined)?.tag === 'nooted:error'
const eventSpan = (events: { timestamp: number }[]) => ({
  start: Math.min(...events.map((e) => e.timestamp)),
  end: Math.max(...events.map((e) => e.timestamp)),
})

test('keyboard narrows the range: aria values change and the report carries the focus', async ({ page }) => {
  const sent = await captureReports(page)
  await open(page)
  await review(page)
  await expect(startHandle(page)).toHaveAttribute('aria-valuenow', '0')
  const max = Number(await endHandle(page).getAttribute('aria-valuemax'))
  expect(max).toBeGreaterThan(1)
  expect(Number(await endHandle(page).getAttribute('aria-valuenow'))).toBe(max)

  await startHandle(page).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await endHandle(page).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')

  const start = Number(await startHandle(page).getAttribute('aria-valuenow'))
  const end = Number(await endHandle(page).getAttribute('aria-valuenow'))
  expect(start).toBeGreaterThan(0)
  expect(end).toBeLessThan(max)
  expect(start).toBeLessThan(end)
  await expect(startHandle(page)).toHaveAttribute('aria-valuetext', `${start.toFixed(1)} s`)
  await expect(endHandle(page)).toHaveAttribute('aria-valuetext', `${end.toFixed(1)} s`)

  await doneButton(page).click()
  await note(page).fill('focused')
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
  expect(sent).toHaveLength(1)
  const report = sent[0]!
  const span = eventSpan(report.events as { timestamp: number }[])
  expect(report.focus).toBeDefined()
  expect(report.focus!.start).toBeGreaterThan(span.start)
  expect(report.focus!.end).toBeLessThan(report.capturedAt)
  expect(report.focus!.start).toBeLessThan(report.focus!.end)
  expect(report.focus!.start - span.start).toBeCloseTo(start * 1000, -2)
  expect(report.capturedAt - report.focus!.end).toBeGreaterThan(0)
  expect(report.recording).toBeUndefined()
})

test('dragging a handle with the pointer moves it', async ({ page }) => {
  const sent = await captureReports(page)
  await open(page)
  await review(page)
  const handle = startHandle(page)
  // The player resizes its box once it has loaded, which moves the timeline. Measure after that.
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  let last = ''
  await expect
    .poll(async () => {
      const box = JSON.stringify(await handle.boundingBox())
      const stable = box === last
      last = box
      return stable
    })
    .toBe(true)
  const handleBox = (await handle.boundingBox())!
  const track = (await host(page).locator('.tl-track').boundingBox())!
  const y = handleBox.y + handleBox.height / 2
  await page.mouse.move(handleBox.x + handleBox.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(track.x + track.width * 0.3, y, { steps: 5 })
  await page.mouse.up()
  const max = Number(await endHandle(page).getAttribute('aria-valuemax'))
  const now = Number(await handle.getAttribute('aria-valuenow'))
  expect(now).toBeGreaterThan(max * 0.2)
  expect(now).toBeLessThan(max * 0.4)

  await doneButton(page).click()
  await note(page).fill('dragged')
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
  expect(sent[0]!.focus).toBeDefined()
})

test('untouched handles send no focus', async ({ page }) => {
  const sent = await captureReports(page)
  await open(page)
  await note(page).fill('plain')
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
  expect(sent[0]!.focus).toBeUndefined()
  expect(sent[0]!.recording).toBeUndefined()
})

test('an error shows as a marker at its time', async ({ page }) => {
  const { errorAt } = await open(page, { error: true })
  await review(page)
  const markers = host(page).locator('.tl-marker')
  await expect(markers).toHaveCount(1)
  const time = Number(await markers.getAttribute('data-time'))
  expect(Math.abs(time - errorAt!)).toBeLessThan(750)
  const frozen = await page.evaluate(() => (window as unknown as { __nootedTestReport: { capturedAt: number; events: { timestamp: number }[] } }).__nootedTestReport)
  const span = eventSpan(frozen.events)
  const fraction = (time - span.start) / (Math.max(frozen.capturedAt, span.end) - span.start)
  const left = await markers.evaluate((el) => parseFloat((el as HTMLElement).style.left))
  expect(left / 100).toBeCloseTo(fraction, 2)
  expect(left).toBeGreaterThan(0)
  expect(left).toBeLessThan(100)
})

test('toggle off hides the timeline and sends only error events, without focus', async ({ page }) => {
  const sent = await captureReports(page)
  const responses: number[] = []
  page.on('response', (r) => r.url().includes('/api/sdk/reports') && r.request().method() === 'POST' && responses.push(r.status()))
  await open(page, { error: true })
  await expect(toggle(page)).toBeChecked()
  await review(page)
  await startHandle(page).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await doneButton(page).click()

  await toggle(page).uncheck()
  await expect(reviewButton(page)).toHaveCount(0)
  await expect(summary(page)).toHaveCount(0)
  await expect(startHandle(page)).toHaveCount(0)
  await expect(host(page).locator('.tl-track')).toHaveCount(0)

  // Turning it back on restores the previous highlight.
  await toggle(page).check()
  await expect(summary(page)).toContainText('Highlighted')
  await review(page)
  expect(Number(await startHandle(page).getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  await doneButton(page).click()
  await toggle(page).uncheck()

  await note(page).fill('no recording')
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
  expect(sent).toHaveLength(1)
  expect(sent[0]!.recording).toBe(false)
  expect(sent[0]!.focus).toBeUndefined()
  expect(sent[0]!.events.length).toBeGreaterThanOrEqual(1)
  expect((sent[0]!.events as { type: number; data?: unknown }[]).every(isError)).toBe(true)
  expect(responses).toEqual([201])
})

test('toggle off with nothing thrown sends an empty event list', async ({ page }) => {
  const sent = await captureReports(page)
  const responses: number[] = []
  page.on('response', (r) => r.url().includes('/api/sdk/reports') && r.request().method() === 'POST' && responses.push(r.status()))
  await open(page)
  await toggle(page).uncheck()
  await note(page).fill('nothing captured')
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
  expect(sent[0]!.recording).toBe(false)
  expect(sent[0]!.events).toEqual([])
  expect(responses).toEqual([201])
})

test('the next trigger starts with the recording on and no focus', async ({ page }) => {
  const sent = await captureReports(page)
  await open(page)
  await review(page)
  await startHandle(page).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await doneButton(page).click()
  await toggle(page).uncheck()
  await note(page).fill('first')
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)

  await fab(page).click()
  await expect(toggle(page)).toBeChecked()
  await expect(summary(page)).toHaveText('Whole recording')
  await review(page)
  await expect(startHandle(page)).toHaveAttribute('aria-valuenow', '0')
  await doneButton(page).click()
  await note(page).fill('second')
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
  expect(sent).toHaveLength(2)
  expect(sent[1]!.recording).toBeUndefined()
  expect(sent[1]!.focus).toBeUndefined()
  expect(sent[1]!.clientReportId).not.toBe(sent[0]!.clientReportId)
})

test('a 401 re-send keeps the id and reflects the choice made in between', async ({ page }) => {
  const requests = await interceptReports(page, (route, n) => (n === 1 ? fulfillStatus(route, 401) : route.continue()))
  await open(page, { error: true })
  await review(page)
  await startHandle(page).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await doneButton(page).click()
  await note(page).fill('retry me')
  await send(page).click()
  await expect(signInButton(page)).toBeVisible()

  await signInThroughPopup(page, 'admin@example.com')
  await expect(note(page)).toHaveValue('retry me', { timeout: 15_000 })
  await toggle(page).uncheck()
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)

  expect(requests).toHaveLength(2)
  expect(requests[0]!.payload.focus).toBeDefined()
  expect(requests[0]!.payload.recording).toBeUndefined()
  expect(requests[1]!.payload.clientReportId).toBe(requests[0]!.payload.clientReportId)
  expect(requests[1]!.payload.recording).toBe(false)
  expect(requests[1]!.payload.focus).toBeUndefined()
  expect(requests[1]!.payload.capturedAt).toBe(requests[0]!.payload.capturedAt)
})

test('Done returns to the form with the note intact and the summary showing the highlight', async ({ page }) => {
  const sent = await captureReports(page)
  await open(page)
  await expect(summary(page)).toHaveText('Whole recording')
  await note(page).fill('keep this text')
  await review(page)
  await expect(host(page).getByRole('heading', { name: 'Highlight what matters' })).toBeVisible()
  await expect(note(page)).toHaveCount(0)
  await startHandle(page).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await endHandle(page).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')
  const start = Number(await startHandle(page).getAttribute('aria-valuenow'))
  const end = Number(await endHandle(page).getAttribute('aria-valuenow'))
  await doneButton(page).click()
  await expect(note(page)).toHaveValue('keep this text')
  await expect(reviewButton(page)).toBeFocused()
  const text = (await summary(page).textContent())!
  const m = /^Highlighted (\d+):(\d{2})–(\d+):(\d{2})$/.exec(text)
  expect(m, text).not.toBeNull()
  expect(text.startsWith('Highlighted 0:')).toBe(true)
  const secs = (mm: string, ss: string) => Number(mm) * 60 + Number(ss)
  expect(secs(m![1]!, m![2]!)).toBe(Math.floor(start))
  expect(secs(m![3]!, m![4]!)).toBe(Math.floor(end))
  // The selection survives re-entering the view.
  await review(page)
  expect(Number(await startHandle(page).getAttribute('aria-valuenow'))).toBeCloseTo(start, 1)
  await doneButton(page).click()
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
  expect(sent[0]!.focus).toBeDefined()
})

test('Reset clears the highlight', async ({ page }) => {
  const sent = await captureReports(page)
  await open(page)
  await review(page)
  await startHandle(page).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await resetButton(page).click()
  await expect(startHandle(page)).toHaveAttribute('aria-valuenow', '0')
  const max = await endHandle(page).getAttribute('aria-valuemax')
  await expect(endHandle(page)).toHaveAttribute('aria-valuenow', max!)
  await doneButton(page).click()
  await expect(summary(page)).toHaveText('Whole recording')
  await note(page).fill('reset')
  await send(page).click()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
  expect(sent[0]!.focus).toBeUndefined()
})

test('Escape in the review view returns to the form, a second Escape closes the window', async ({ page }) => {
  await open(page)
  await review(page)
  await page.keyboard.press('Escape')
  await expect(note(page)).toBeVisible()
  await expect(host(page).getByRole('dialog')).toHaveCount(1)
  await expect(reviewButton(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
})

test('with the recording off there is no review button or summary', async ({ page }) => {
  await open(page)
  await expect(reviewButton(page)).toBeVisible()
  await expect(summary(page)).toBeVisible()
  await toggle(page).uncheck()
  await expect(reviewButton(page)).toHaveCount(0)
  await expect(summary(page)).toHaveCount(0)
})
