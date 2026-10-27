import { expect, test } from '@playwright/test'
import { NOOTED_URL, STORAGE_STATE } from './env.ts'
import { collectNootedLogs, debugNooted, enableNooted, waitForRuntime } from './helpers.ts'

// The playground's header middleware picks the policy per request from ?csp= and ?coop=.

test.beforeEach(async ({ page }) => {
  await enableNooted(page)
})

test('strict CSP: the external loader file and the Nooted origin are allowed, the runtime takes over', async ({ page }) => {
  const logs = collectNootedLogs(page)
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  const response = await page.goto('/?csp=strict')
  expect(response?.headers()['content-security-policy']).toContain(`script-src 'self' ${NOOTED_URL}`)
  await waitForRuntime(page)
  expect(logs).toEqual([])
  expect(pageErrors).toEqual([])
})

test('nonce CSP: the nonce reaches the injected script and the runtime runs', async ({ page }) => {
  const logs = collectNootedLogs(page)
  const response = await page.goto('/?csp=nonce')
  const policy = response?.headers()['content-security-policy'] ?? ''
  // The Nooted origin is deliberately not listed: only the nonce can let the SDK script run.
  expect(policy).not.toMatch(new RegExp(`script-src[^;]*${NOOTED_URL}`))

  await waitForRuntime(page)
  const nonces = await page.evaluate(() => ({
    sdk: document.querySelector<HTMLScriptElement>('script[src$="/sdk/v1/nooted.js"]')?.nonce,
    loader: document.querySelector<HTMLScriptElement>('script[src*="nooted-loader-"]')?.nonce,
  }))
  expect(nonces.sdk).toBeTruthy()
  expect(nonces.sdk).toBe(nonces.loader)
  expect(policy).toContain(`'nonce-${nonces.sdk}'`)
  expect(logs).toEqual([])
})

test('a CSP without the Nooted origin: one [nooted] warning naming script-src, the page keeps working', async ({ page }) => {
  const logs = collectNootedLogs(page)
  await page.goto('/?csp=missing')
  await expect.poll(() => logs.length).toBe(1)
  expect(logs[0]!.type).toBe('warning')
  expect(logs[0]!.text).toContain('script-src')
  expect(await page.evaluate(() => window.nooted?.t)).toBeUndefined()

  await page.locator('a[data-route="/checkout"]').click()
  await expect(page.locator('#page-checkout')).toBeVisible()
  await page.evaluate(() => window.nooted?.open())
  // Nothing else is logged later on.
  await page.waitForTimeout(300)
  expect(logs).toHaveLength(1)
})

test('the coop mode sends Cross-Origin-Opener-Policy', async ({ page }) => {
  const response = await page.goto('/?coop=same-origin')
  expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin')
})

// With COOP same-origin on the host page the sign-in popup has no opener, so it can't deliver the token
// and its page explains why. The admin session skips the Dex login so the popup lands on the explanation.
test.describe('COOP popup', () => {
  test.use({ storageState: STORAGE_STATE })

  test('COOP same-origin: the sign-in popup shows the COOP explanation', async ({ page, context }) => {
    await debugNooted(page)
    await page.goto('/?coop=same-origin')
    await waitForRuntime(page)
    await page.locator('#nooted-host').getByRole('button', { name: 'Report a problem' }).click()
    const popupPromise = context.waitForEvent('page')
    await page.locator('#nooted-host').getByRole('button', { name: 'Sign in to Nooted' }).click()
    const popup = await popupPromise
    await expect(popup.locator('#msg')).toContainText('Cross-Origin-Opener-Policy', { timeout: 15_000 })
    await expect(popup.locator('#msg')).toContainText('same-origin-allow-popups')
    // No token reached the opener.
    await expect(page.locator('#nooted-host').getByRole('button', { name: 'Sign in to Nooted' })).toBeVisible()
  })
})
