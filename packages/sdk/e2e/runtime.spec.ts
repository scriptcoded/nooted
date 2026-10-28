import { expect, test } from '@playwright/test'
import { PLAYGROUND_URL } from './env.ts'
import { collectNootedLogs, enableNooted, trackNootedRequests, waitForRuntime } from './helpers.ts'

const bundle = (url: string) => url.endsWith('/sdk/v1/nooted.js')
const flag = (page: import('@playwright/test').Page) => page.evaluate(() => localStorage.getItem('nooted:enabled'))

test('#nooted has no effect: no bundle request, URL unchanged, flag unset', async ({ page }) => {
  const requests = trackNootedRequests(page)
  await page.goto('/cart#nooted')
  await page.waitForLoadState('networkidle')
  expect(requests.filter(bundle)).toEqual([])
  expect(page.url()).toBe(`${PLAYGROUND_URL}/cart#nooted`)
  expect(await flag(page)).toBeNull()
  expect(await page.evaluate(() => window.nooted?.t)).toBeUndefined()
})

test('#nooted-off does not clear the flag or change the URL', async ({ page }) => {
  await enableNooted(page)
  await page.goto('/?off=1#nooted-off')
  await waitForRuntime(page)
  expect(page.url()).toBe(`${PLAYGROUND_URL}/?off=1#nooted-off`)
  expect(await flag(page)).toBe('1')
})

test('nooted.init() enables: bundle fetched, flag set, queued calls taken over', async ({ page }) => {
  const requests = trackNootedRequests(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  expect(requests.filter(bundle)).toEqual([])

  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/sdk/v1/nooted.js', async (route) => {
    await gate
    await route.continue()
  })
  await page.evaluate(() => window.nooted?.init())
  expect(await flag(page)).toBe('1')
  expect(await page.evaluate(() => window.nooted?.q.map(([name]) => name))).toEqual(['init'])
  release()
  await waitForRuntime(page)
  expect(requests.filter(bundle)).toHaveLength(1)
  expect(await page.evaluate(() => window.nooted?.q.length)).toBe(0)
})

test('the playground Enable and Disable buttons work', async ({ page }) => {
  const requests = trackNootedRequests(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Enable Nooted' }).click()
  await waitForRuntime(page)
  expect(await flag(page)).toBe('1')
  expect(requests.filter(bundle)).toHaveLength(1)

  await page.getByRole('button', { name: 'Disable Nooted' }).click()
  await expect(page.locator('#nooted-host')).toHaveCount(0)
  expect(await flag(page)).toBeNull()

  // Enabling again on the same page brings everything back without a reload or a second bundle request.
  await page.getByRole('button', { name: 'Enable Nooted' }).click()
  await expect(page.locator('#nooted-host')).toHaveCount(1)
  expect(await flag(page)).toBe('1')
  expect(requests.filter(bundle)).toHaveLength(1)
  await page.keyboard.press('Control+Shift+Period')
  await expect(page.locator('#nooted-host')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.dataset.nootedOpened)).toBe('1')
})

test('a disable() queued before the runtime loads leaves Nooted off', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    window.nooted?.init()
    window.nooted?.disable()
  })
  await expect.poll(() => page.evaluate(() => window.nooted?.t === true)).toBe(true)
  await page.waitForTimeout(300)
  await expect(page.locator('#nooted-host')).toHaveCount(0)
  expect(await flag(page)).toBeNull()
})

test('nooted.disable() tears down, and later loads make no bundle request', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.nooted?.init())
  await waitForRuntime(page)
  await expect(page.locator('#nooted-host')).toHaveCount(1)

  await page.evaluate(() => window.nooted!.disable())
  await expect(page.locator('#nooted-host')).toHaveCount(0)
  expect(await flag(page)).toBeNull()

  const requests = trackNootedRequests(page)
  await page.reload()
  await page.waitForLoadState('networkidle')
  expect(requests.filter(bundle)).toEqual([])
})

test('an early nooted.open() call reaches the runtime once it loads', async ({ page }) => {
  await enableNooted(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/sdk/v1/nooted.js', async (route) => {
    await gate
    await route.continue()
  })

  // The held async script would delay the load event, so wait for DOMContentLoaded (the page's own modules have run by then).
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('#report-problem').click()
  // Still queued: the runtime has not arrived.
  expect(await page.evaluate(() => ({ queued: window.nooted?.q.map(([name]) => name), taken: window.nooted?.t }))).toEqual({
    queued: ['open'],
    taken: undefined,
  })

  release()
  await waitForRuntime(page)
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.nootedOpened)).toBe('1')
  expect(await page.evaluate(() => window.nooted?.q.length)).toBe(0)

  // After takeover, calls go straight to the runtime. The window is open, so a second trigger is ignored.
  await page.evaluate(() => window.nooted?.open())
  expect(await page.evaluate(() => document.documentElement.dataset.nootedOpened)).toBe('1')
})

test('the app keeps working when the bundle URL returns 500', async ({ page }) => {
  await enableNooted(page)
  await page.route('**/sdk/v1/nooted.js', (route) => route.fulfill({ status: 500, body: 'nope' }))
  const logs = collectNootedLogs(page)
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto('/')
  await expect.poll(() => logs.length).toBe(1)
  expect(logs[0]!.text).toContain('nooted.js')

  // The page's own controls still work, and the API call doesn't throw.
  await page.locator('#report-problem').click()
  await page.locator('a[data-route="/checkout"]').click()
  await expect(page.locator('#page-checkout')).toBeVisible()
  await page.evaluate(() => window.nooted?.open())
  expect(pageErrors).toEqual([])
})

test('the loader adds no error or unhandledrejection listeners, before or after the runtime loads', async ({ page, browser }) => {
  // The dev server's own scripts may listen for errors, so compare with a page that has Nooted off.
  const spy = () => {
    const seen: string[] = []
    ;(window as any).__windowListeners = seen
    const add = EventTarget.prototype.addEventListener
    EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: [any, any?]) {
      if (this === window) seen.push(type)
      return add.call(this, type, ...rest)
    }
  }
  const errorListeners = (page: import('@playwright/test').Page) =>
    page.evaluate(() => ((window as any).__windowListeners as string[]).filter((t) => t === 'error' || t === 'unhandledrejection').length)

  const baselinePage = await (await browser.newContext()).newPage()
  await baselinePage.addInitScript(spy)
  await baselinePage.goto('/')
  await baselinePage.waitForLoadState('load')
  const baseline = await errorListeners(baselinePage)
  expect(await baselinePage.evaluate(() => window.nooted?.t)).toBeUndefined()
  await baselinePage.context().close()

  await enableNooted(page)
  await page.addInitScript(spy)
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/sdk/v1/nooted.js', async (route) => {
    await gate
    await route.continue()
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // The loader has run and is waiting for the runtime.
  expect(await page.evaluate(() => window.nooted?.t)).toBeUndefined()
  expect(await errorListeners(page)).toBe(baseline)

  release()
  await waitForRuntime(page)
  expect(await errorListeners(page)).toBe(baseline)
  // The stub has no error queue any more.
  expect(await page.evaluate(() => Object.keys(window.nooted!).includes('e'))).toBe(false)
})
