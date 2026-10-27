import { expect, test, type Page } from '@playwright/test'
import {
  captureReports,
  debugNooted,
  enableNooted,
  seedRealToken,
  waitForRuntime,
} from './helpers.ts'

const host = (page: Page) => page.locator('#nooted-host')
const fab = (page: Page) => host(page).getByRole('button', { name: 'Report a problem' })
const note = (page: Page) => host(page).getByRole('textbox', { name: 'What went wrong?' })
const send = (page: Page) => host(page).getByRole('button', { name: 'Send', exact: true })
const reviewButton = (page: Page) => host(page).getByRole('button', { name: 'Review recording' })
const doneButton = (page: Page) => host(page).getByRole('button', { name: 'Done', exact: true })
const summary = (page: Page) => host(page).locator('.review-summary')
const replay = (page: Page) => page.frameLocator('#nooted-host iframe')

interface PreviewState {
  time: number
  playing: boolean
  duration: number
}
const previewState = (page: Page) => page.evaluate(() => (window as unknown as { __nootedPreview?: PreviewState }).__nootedPreview)

test.beforeEach(async ({ page }) => {
  await debugNooted(page)
  await enableNooted(page)
  await seedRealToken(page)
})

/** Types an email, changes a heading right before the trigger, and opens the report window. */
async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await waitForRuntime(page)
  await page.locator('a[data-route="/checkout"]').click()
  await page.locator('#email').fill('alice.secret@example.com')
  await page.locator('#email').blur()
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    document.querySelector('#page-checkout h2')!.textContent = 'Final heading'
  })
  await page.waitForTimeout(300)
  await fab(page).click()
  await expect(note(page)).toBeVisible()
}

test('the preview shows the masked email and ends at the trigger time, paused', async ({ page }) => {
  await open(page)
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  const email = replay(page).locator('#email')
  await expect(email).toHaveCount(1)
  const value = await email.evaluate((el) => (el as HTMLInputElement).value)
  expect(value).toMatch(/^\*+$/)
  expect(value).not.toContain('alice')
  // The last change before the trigger is in the shown frame.
  await expect(replay(page).locator('#page-checkout h2')).toHaveText('Final heading')
  const state = (await previewState(page))!
  expect(state.playing).toBe(false)
  expect(state.duration).toBeGreaterThan(1500)
  expect(state.time).toBeGreaterThan(state.duration - 400)
})

test('play and pause toggle, and the time advances while playing', async ({ page }) => {
  await open(page)
  await reviewButton(page).click()
  const play = host(page).getByRole('button', { name: 'Play preview' })
  await play.click()
  const pause = host(page).getByRole('button', { name: 'Pause preview' })
  await expect(pause).toBeVisible()
  // Playing starts at the beginning, so the time is well before the end and moves forward.
  await expect.poll(async () => (await previewState(page))!.time, { timeout: 3000 }).toBeGreaterThan(0)
  const a = (await previewState(page))!.time
  await page.waitForTimeout(500)
  const b = (await previewState(page))!.time
  expect(b).toBeGreaterThan(a)
  await pause.click()
  await expect(host(page).getByRole('button', { name: 'Play preview' })).toBeVisible()
  const paused = (await previewState(page))!.time
  await page.waitForTimeout(400)
  expect((await previewState(page))!.time).toBeCloseTo(paused, -2)
})

test('the timeline seeks the preview and playing loops inside the focus range', async ({ page }) => {
  await open(page)
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  const start = host(page).getByRole('slider', { name: 'Focus start' })
  const end = host(page).getByRole('slider', { name: 'Focus end' })
  await start.focus()
  for (let i = 0; i < 20; i++) await start.press('ArrowRight')
  // Seeking is relative to the first event: the preview is now at the start handle, well before the end.
  const duration = (await previewState(page))!.duration
  await expect.poll(async () => (await previewState(page))!.time).toBeLessThan(duration * 0.5)
  const from = (await previewState(page))!.time
  expect(from).toBeGreaterThan(duration * 0.1)
  await end.focus()
  for (let i = 0; i < 40; i++) await end.press('ArrowLeft')
  const to = (await previewState(page))!.time
  expect(to).toBeGreaterThan(from)
  await host(page).getByRole('button', { name: 'Play preview' }).click()
  // Playback stays within the focus range across several loop periods.
  const seen: number[] = []
  for (let i = 0; i < 20; i++) {
    seen.push((await previewState(page))!.time)
    await page.waitForTimeout(150)
  }
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(from - 150)
  expect(Math.max(...seen)).toBeLessThanOrEqual(to + 250)
  expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(100)
})

test('leaving the review view destroys the replayer, and turning the recording off hides the entry', async ({ page }) => {
  await open(page)
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  await doneButton(page).click()
  await expect(host(page).locator('iframe')).toHaveCount(0)
  await expect.poll(() => previewState(page)).toBeUndefined()
  await expect(reviewButton(page)).toBeFocused()
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  await doneButton(page).click()
  await host(page).getByRole('switch', { name: /Include recording/ }).click()
  await expect(reviewButton(page)).toHaveCount(0)
  await expect(summary(page)).toHaveCount(0)
  await host(page).getByRole('switch', { name: /Include recording/ }).click()
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
})

test('the replay iframe cannot run scripts', async ({ page }) => {
  await open(page)
  await reviewButton(page).click()
  const iframe = host(page).locator('.preview-player iframe')
  await expect(iframe).toBeVisible()
  const sandbox = await iframe.getAttribute('sandbox')
  expect(sandbox).not.toBeNull()
  expect(sandbox!.split(/\s+/)).not.toContain('allow-scripts')
})

test('at 320 px both views fit without horizontal scrolling and show all controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await open(page)
  const noOverflow = async () => {
    const m = await host(page).evaluate((h) => {
      const panel = h.shadowRoot!.querySelector('.panel') as HTMLElement
      return {
        panel: [panel.scrollWidth, panel.clientWidth],
        doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      }
    })
    expect(m.panel[0]).toBeLessThanOrEqual(m.panel[1]!)
    expect(m.doc[0]).toBeLessThanOrEqual(m.doc[1]!)
  }
  await expect(reviewButton(page)).toBeVisible()
  await expect(summary(page)).toBeVisible()
  await noOverflow()
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  await expect(replay(page).locator('#email')).toHaveCount(1)
  for (const control of [
    host(page).getByRole('heading', { name: 'Highlight what matters' }),
    host(page).getByRole('button', { name: 'Play preview' }),
    host(page).getByRole('slider', { name: 'Focus start' }),
    host(page).getByRole('slider', { name: 'Focus end' }),
    host(page).getByRole('button', { name: 'Reset' }),
    doneButton(page),
  ]) {
    await expect(control).toBeInViewport()
  }
  await noOverflow()
  const m = await host(page).evaluate((h) => {
    const root = h.shadowRoot!
    const box = root.querySelector('.preview-player') as HTMLElement
    const wrapper = root.querySelector('.replayer-wrapper') as HTMLElement
    return {
      box: box.clientWidth,
      boxHeight: box.clientHeight,
      wrapper: wrapper.getBoundingClientRect().width,
      wrapperLayout: wrapper.offsetWidth,
    }
  })
  expect(m.wrapper).toBeLessThanOrEqual(m.box + 0.5)
  expect(m.wrapperLayout).toBeGreaterThan(m.box) // actually scaled down
  expect(m.boxHeight).toBeLessThanOrEqual(640 * 0.45 + 2)
})

test('a replay player that fails to load shows a message while the timeline and Send keep working', async ({ page }) => {
  const sent = await captureReports(page)
  await page.route('**/sdk/v1/replay.js', (route) => route.fulfill({ status: 500, body: 'no' }))
  await open(page)
  await reviewButton(page).click()
  await expect(host(page).getByText('Preview unavailable')).toBeVisible()
  const start = host(page).getByRole('slider', { name: 'Focus start' })
  await start.focus()
  for (let i = 0; i < 20; i++) await start.press('ArrowRight')
  await doneButton(page).click()
  await note(page).fill('player broke')
  await send(page).click()
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]!.focus).toBeDefined()
  await expect(host(page).getByRole('dialog')).toHaveCount(0)
})

test('a CSP without inline styles shows the unstyled notice, and Send still works', async ({ page }) => {
  const sent = await captureReports(page)
  await open(page, '/?csp=strict-style')
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  await expect(host(page).getByText("The preview may look unstyled because of this site's security policy.")).toBeVisible()
  await doneButton(page).click()
  await note(page).fill('csp')
  await send(page).click()
  await expect.poll(() => sent.length).toBe(1)
})

test('without a style-blocking CSP there is no notice', async ({ page }) => {
  await open(page, '/?csp=strict')
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  await page.waitForTimeout(2000)
  await expect(host(page).getByText(/may look unstyled/)).toHaveCount(0)
})
