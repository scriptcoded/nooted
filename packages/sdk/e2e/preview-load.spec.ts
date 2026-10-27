import { expect, test, type Page } from '@playwright/test'
import { debugNooted, enableNooted, seedToken, waitForRuntime } from './helpers.ts'

const host = (page: Page) => page.locator('#nooted-host')
const fab = (page: Page) => host(page).getByRole('button', { name: 'Report a problem' })
const note = (page: Page) => host(page).getByRole('textbox', { name: 'What went wrong?' })
const reviewButton = (page: Page) => host(page).getByRole('button', { name: 'Review recording' })

function trackReplayRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/sdk/v1/replay.js')) urls.push(request.url())
  })
  return urls
}

test.beforeEach(async ({ page }) => {
  await debugNooted(page)
  await enableNooted(page)
  await seedToken(page)
})

test('opening the window and using the form never fetches the replay player', async ({ page }) => {
  const requests = trackReplayRequests(page)
  await page.goto('/')
  await waitForRuntime(page)
  await fab(page).click()
  await expect(note(page)).toBeVisible()
  await note(page).fill('typing')
  await expect(reviewButton(page)).toBeVisible()
  await host(page).getByRole('switch', { name: /Include recording/ }).click()
  await host(page).getByRole('switch', { name: /Include recording/ }).click()
  await page.waitForTimeout(500)
  expect(requests).toEqual([])
  expect(await page.evaluate(() => window.nooted?.p)).toBeUndefined()
})

test('the Review recording button loads and registers the player, once', async ({ page }) => {
  const requests = trackReplayRequests(page)
  await page.goto('/')
  await waitForRuntime(page)
  await fab(page).click()
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  expect(await page.evaluate(() => typeof window.nooted?.p?.createReplayer)).toBe('function')
  expect(requests).toHaveLength(1)
})

test('under a nonce CSP the replay script carries the nonce and loads', async ({ page }) => {
  const requests = trackReplayRequests(page)
  await page.goto('/?csp=nonce')
  await waitForRuntime(page)
  await fab(page).click()
  await reviewButton(page).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  expect(requests).toHaveLength(1)
  const nonces = await page.evaluate(() => ({
    sdk: document.querySelector<HTMLScriptElement>('script[src$="/sdk/v1/nooted.js"]')?.nonce,
    replay: document.querySelector<HTMLScriptElement>('script[src$="/sdk/v1/replay.js"]')?.nonce,
    registered: typeof window.nooted?.p?.createReplayer,
  }))
  expect(nonces.replay).toBeTruthy()
  expect(nonces.replay).toBe(nonces.sdk)
  expect(nonces.registered).toBe('function')
})

test('a failed load shows "Preview unavailable" and can be retried', async ({ page }) => {
  let calls = 0
  await page.route('**/sdk/v1/replay.js', (route) => (++calls === 1 ? route.fulfill({ status: 500, body: 'no' }) : route.continue()))
  await page.goto('/')
  await waitForRuntime(page)
  await fab(page).click()
  await reviewButton(page).click()
  await expect(host(page).getByText('Preview unavailable')).toBeVisible()
  await host(page).getByRole('button', { name: 'Retry' }).click()
  await expect(host(page).locator('.preview-player iframe')).toBeVisible()
  expect(calls).toBe(2)
})
