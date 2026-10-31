import { expect, test, type Page } from '@playwright/test'
import { bar, dialog, done, draftCaptures, fab, host, mark, note, pointButton, setup } from './capture-helpers.ts'

const bubble = (page: Page) => host(page).getByRole('button', { name: 'Continue your change request' })
const cancel = (page: Page) => host(page).getByRole('button', { name: 'Cancel' })
const count = (page: Page) => page.locator('#fx-count')
const opened = (page: Page) => page.evaluate(() => document.documentElement.dataset.nootedOpened ?? '0')

/** Taps the dimmed area in the top-left corner, outside the centered window. */
const tapOutside = (page: Page) => page.mouse.click(4, 4)

async function openWithNote(page: Page, text = 'hello world'): Promise<void> {
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  await note(page).fill(text)
}

async function addScreenshot(page: Page, selector = '#fx-heading'): Promise<void> {
  await pointButton(page).click()
  await expect(bar(page)).toBeVisible()
  await mark(page, selector)
  await done(page)
}

test('tapping outside minimizes to a bubble and the page is clickable underneath', async ({ page }) => {
  await setup(page)
  await openWithNote(page)
  await tapOutside(page)
  await expect(dialog(page)).toHaveCount(0)
  await expect(bubble(page)).toBeVisible()
  await expect(fab(page)).toHaveCount(0)
  await page.locator('#fx-counter').click()
  await expect(count(page)).toHaveText('1')
  await expect(bubble(page)).toBeFocused()
})

test('the bubble restores the note, captures and caret', async ({ page }) => {
  await setup(page)
  await openWithNote(page, 'make this bigger please')
  await addScreenshot(page)
  await expect(note(page)).toHaveValue('make this bigger please[1]')
  await note(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 9))
  await tapOutside(page)
  await expect(dialog(page)).toHaveCount(0)
  await bubble(page).click()
  await expect(dialog(page)).toBeVisible()
  await expect(note(page)).toHaveValue('make this bigger please[1]')
  await expect(note(page)).toBeFocused()
  expect(await note(page).evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([4, 9])
  expect(await draftCaptures(page)).toHaveLength(1)
  await expect(host(page).getByRole('listitem')).toHaveCount(1)
})

test('after a client-side route change, restoring and taking a screenshot numbers it next with the new URL', async ({ page }) => {
  await setup(page)
  await openWithNote(page, 'see ')
  await addScreenshot(page)
  await tapOutside(page)
  await page.locator('a[data-route="/cart"]').click()
  await expect(page).toHaveURL(/\/cart$/)
  await bubble(page).click()
  await expect(dialog(page)).toBeVisible()
  await addScreenshot(page, '#page-cart')
  const captures = await draftCaptures(page)
  expect(captures.map((c) => c.n)).toEqual([1, 2])
  expect(captures[1]!.url).toBe(page.url())
  expect(captures[1]!.url).toMatch(/\/cart$/)
  await expect(note(page)).toHaveValue(/^see \[1\].*\[2\]/)
})

test('a drag that starts in the note and ends on the backdrop does not minimize', async ({ page }) => {
  await setup(page)
  await openWithNote(page, 'select some text here')
  const box = (await note(page).boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(4, 4, { steps: 5 })
  await page.mouse.up()
  await expect(dialog(page)).toBeVisible()
  await expect(bubble(page)).toHaveCount(0)
})

test('the shortcut and nooted.open() restore the same draft without starting a new report', async ({ page }) => {
  await setup(page)
  await openWithNote(page, 'keep me')
  const before = await opened(page)
  await tapOutside(page)
  await expect(bubble(page)).toBeVisible()

  await page.keyboard.press('Control+Shift+.')
  await expect(dialog(page)).toBeVisible()
  await expect(note(page)).toHaveValue('keep me')

  await tapOutside(page)
  await expect(dialog(page)).toHaveCount(0)
  await page.evaluate(() => window.nooted?.open())
  await expect(dialog(page)).toBeVisible()
  await expect(note(page)).toHaveValue('keep me')
  expect(await opened(page)).toBe(before)
})

test('with button: false the bubble shows only while minimized', async ({ page }) => {
  await page.addInitScript(() => {
    const t = setInterval(() => {
      if (window.nooted) {
        window.nooted.init({ button: false })
        clearInterval(t)
      }
    }, 1)
  })
  await setup(page)
  await expect(fab(page)).toHaveCount(0)
  await page.evaluate(() => window.nooted?.open())
  await expect(dialog(page)).toBeVisible()
  await note(page).fill('draft')
  await tapOutside(page)
  await expect(bubble(page)).toBeVisible()
  await bubble(page).click()
  await expect(dialog(page)).toBeVisible()
  await expect(note(page)).toHaveValue('draft')
  await cancel(page).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(bubble(page)).toHaveCount(0)
  await expect(fab(page)).toHaveCount(0)
})

test('Cancel after restoring discards the draft and the normal button returns', async ({ page }) => {
  await setup(page)
  await openWithNote(page, 'discard me')
  await tapOutside(page)
  await bubble(page).click()
  await cancel(page).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(bubble(page)).toHaveCount(0)
  await expect(fab(page)).toBeVisible()
  await fab(page).click()
  await expect(note(page)).toHaveValue('')
})

test('Escape while minimized does nothing', async ({ page }) => {
  await setup(page)
  await openWithNote(page, 'still here')
  await tapOutside(page)
  await page.keyboard.press('Escape')
  await expect(bubble(page)).toBeVisible()
  await bubble(page).click()
  await expect(note(page)).toHaveValue('still here')
})

test('dragging the bubble moves it without restoring the window', async ({ page }) => {
  await setup(page)
  await openWithNote(page)
  await tapOutside(page)
  const b = bubble(page)
  const from = (await b.boundingBox())!
  await page.mouse.move(from.x + 24, from.y + 24)
  await page.mouse.down()
  await page.mouse.move(from.x - 150, from.y - 150, { steps: 8 })
  await page.mouse.up()
  await expect(dialog(page)).toHaveCount(0)
  const to = (await b.boundingBox())!
  expect(to.x).toBeLessThan(from.x - 100)
})
