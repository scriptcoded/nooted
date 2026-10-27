import { expect, test } from '@playwright/test'
import { trackNootedRequests } from './helpers.ts'

test('with the flag unset the playground makes no requests to Nooted', async ({ page }) => {
  const requests = trackNootedRequests(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  // The loader defines its stub but stays dormant.
  expect(await page.evaluate(() => typeof window.nooted)).toBe('object')
  expect(await page.evaluate(() => window.nooted?.t)).toBeUndefined()
  expect(requests).toEqual([])
})
