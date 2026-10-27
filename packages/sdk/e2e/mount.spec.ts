import { expect, test } from '@playwright/test'
import { debugNooted, enableNooted, waitForRuntime } from './helpers.ts'

const fab = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Report a problem' })

test.beforeEach(async ({ page }) => {
  await enableNooted(page)
  await debugNooted(page)
})

test('hostile page CSS does not hide or break the floating button', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await page.addStyleTag({
    content: 'button { display: none !important } div { visibility: hidden !important } * { font-size: 40px !important }',
  })
  const button = page.locator('#nooted-host').getByRole('button', { name: 'Report a problem' })
  await expect(button).toBeVisible()
  const box = await button.boundingBox()
  expect(box!.width).toBeLessThan(80)
  await button.click()
  await expect(page.getByRole('dialog', { name: 'Report a problem' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the host does not block clicks on the page', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await expect(fab(page).first()).toBeVisible()
  await page.locator('a[data-route="/checkout"]').click()
  await expect(page.locator('#page-checkout')).toBeVisible()
})

test('the host is re-attached when the page replaces the body contents or the body', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await expect(fab(page).first()).toBeVisible()

  await page.evaluate(() => {
    document.body.innerHTML = '<p>x</p>'
  })
  await expect(page.locator('#nooted-host')).toHaveCount(1)
  await expect(fab(page).first()).toBeVisible()

  await page.evaluate(() => {
    document.body.replaceWith(document.createElement('body'))
  })
  await expect(page.locator('body > #nooted-host')).toHaveCount(1)
  await expect(fab(page).first()).toBeVisible()

  await page.evaluate(() => {
    document.body = document.createElement('body')
  })
  await expect(page.locator('body > #nooted-host')).toHaveCount(1)
  await expect(fab(page).first()).toBeVisible()
})

test('the shadow root is closed unless nooted:debug is set', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('nooted:debug'))
  await page.goto('/')
  await waitForRuntime(page)
  await expect(page.locator('#nooted-host')).toHaveCount(1)
  expect(await page.evaluate(() => document.querySelector('#nooted-host')!.shadowRoot)).toBeNull()
})
