import { expect, test } from '@playwright/test'
import { PLAYGROUND_URL } from './env.ts'
import { collectNootedLogs, enableNooted, trackNootedRequests, waitForRuntime } from './helpers.ts'

const bundle = (url: string) => url.endsWith('/sdk/v1/nooted.js')
const flag = (page: import('@playwright/test').Page) => page.evaluate(() => localStorage.getItem('nooted:enabled'))

test('#nooted enables Nooted: bundle fetched, URL cleaned, flag set', async ({ page }) => {
  const requests = trackNootedRequests(page)
  await page.goto('/cart#nooted')
  await waitForRuntime(page)
  expect(requests.filter(bundle)).toHaveLength(1)
  expect(page.url()).toBe(`${PLAYGROUND_URL}/cart`)
  expect(await flag(page)).toBe('1')
})

test('#nooted-off clears the flag, and the next load makes no bundle request', async ({ page }) => {
  await page.goto('/#nooted')
  await waitForRuntime(page)

  const requests = trackNootedRequests(page)
  // A different query string forces a real navigation (a hash-only change would not reload).
  await page.goto('/?off=1#nooted-off')
  await page.waitForLoadState('networkidle')
  expect(await flag(page)).toBeNull()
  expect(page.url()).toBe(`${PLAYGROUND_URL}/?off=1`)

  await page.reload()
  await page.waitForLoadState('networkidle')
  expect(requests.filter(bundle)).toEqual([])
  expect(await page.evaluate(() => window.nooted?.t)).toBeUndefined()
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
