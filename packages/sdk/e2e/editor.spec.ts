import { expect, test, type Page } from '@playwright/test'
import { recordButton, stopRecording, pointButton, barButton, captureAfter, dialog, done, draftCaptures, fab, host, mark, note, setup } from './capture-helpers.ts'
import { captureReports, seedRealToken, trackNootedRequests } from './helpers.ts'

const card = (page: Page, n: number) => host(page).locator(`[data-nooted-card="${n}"]`)
const removeButton = (page: Page, n: number) => host(page).getByRole('button', { name: `Remove capture ${n}` })
const thumbFrame = (page: Page, n = 1) => page.frameLocator(`#nooted-host [data-nooted-card="${n}"] iframe`)
const openRow = (page: Page, n: number) => card(page, n).locator('.row-main')
const selection = (page: Page) => note(page).evaluate((el) => [(el as HTMLTextAreaElement).selectionStart, (el as HTMLTextAreaElement).selectionEnd])

test.describe('editor', () => {
  test('an inline capture: "If I click [1] I want a confirmation"', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'If I click ', '#fx-counter')
    await expect(note(page)).toHaveValue('If I click [1] ')
    await page.keyboard.type('I want a confirmation')
    await expect(note(page)).toHaveValue('If I click [1] I want a confirmation')
    await expect(card(page, 1)).toContainText('[1]ScreenshotAdd to cart')
  })

  test('a hand-typed token without a capture blocks Send with an explanation', async ({ page }) => {
    await setup(page)
    await fab(page).click()
    await note(page).fill('Make this bigger, like [2]')
    const send = host(page).getByRole('button', { name: 'Send' })
    await expect(send).toBeDisabled()
    await expect(host(page).getByRole('alert')).toContainText("mentions [2], but there's no capture")
    await note(page).fill('Make this bigger')
    await expect(send).toBeEnabled()
    await expect(host(page).getByRole('alert')).toHaveCount(0)
  })

  test('the token goes after the selection, with spaces as needed', async ({ page }) => {
    await setup(page)
    await fab(page).click()
    await note(page).fill('the button now')
    await note(page).evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(4, 10))
    await pointButton(page).click()
    await mark(page, '#fx-counter')
    await done(page)
    await expect(note(page)).toHaveValue('the button [1] now')
    expect(await selection(page)).toEqual([15, 15])
  })

  test('removing capture 1 strips its tokens; capture 2 keeps its number; new numbers do not collide', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'A ', '#fx-counter')
    await captureAfter(page, 'and B ', '#fx-icon')
    await page.keyboard.type('end')
    await expect(note(page)).toHaveValue('A [1] and B [2] end')

    await removeButton(page, 1).click()
    await expect(card(page, 1)).toHaveCount(0)
    await expect(card(page, 2)).toBeVisible()
    await expect(note(page)).toHaveValue('A and B [2] end')

    await captureAfter(page, ' also ', '#fx-link')
    expect((await draftCaptures(page)).map((c) => c.n)).toEqual([2, 3])
    await expect(note(page)).toHaveValue('A and B [2] end also [3] ')

    // Removing the highest and adding again does not reuse its number.
    await removeButton(page, 3).click()
    await expect(note(page)).toHaveValue('A and B [2] end also')
    await captureAfter(page, ' and ', '#fx-name')
    expect((await draftCaptures(page)).map((c) => c.n)).toEqual([2, 4])
    await expect(note(page)).toHaveValue('A and B [2] end also and [4] ')
  })

  test('Cancel in capture mode leaves the note unchanged and puts the caret back', async ({ page }) => {
    await setup(page)
    await fab(page).click()
    await note(page).fill('hello world')
    await note(page).evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(5, 5))
    await pointButton(page).click()
    await mark(page, '#fx-counter')
    await barButton(page, 'Cancel').click()
    await expect(note(page)).toBeFocused()
    await expect(note(page)).toHaveValue('hello world')
    expect(await selection(page)).toEqual([5, 5])
    expect(await draftCaptures(page)).toEqual([])
  })

  test('the limit: ten captures disable Screenshot and Record with a message', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'one ', '#fx-counter')
    await expect(pointButton(page)).toBeEnabled()
    await expect(recordButton(page)).toBeEnabled()
    await expect(host(page).getByText('Up to 10 captures per report')).toHaveCount(0)
    await page.evaluate(() => (window as unknown as { __nootedFillCaptures: (n: number) => void }).__nootedFillCaptures(10))
    await expect(pointButton(page)).toBeDisabled()
    await expect(recordButton(page)).toBeDisabled()
    await expect(host(page).getByText('Up to 10 captures per report')).toBeVisible()
    await removeButton(page, 10).click()
    await expect(pointButton(page)).toBeEnabled()
    await expect(recordButton(page)).toBeEnabled()
    await expect(host(page).getByText('Up to 10 captures per report')).toHaveCount(0)
  })
})

test.describe('previews', () => {
  test('a text-only report never requests replay.js', async ({ page }) => {
    const urls = trackNootedRequests(page)
    await setup(page)
    await fab(page).click()
    await note(page).fill('just text')
    await page.waitForTimeout(500)
    expect(urls.filter((u) => u.includes('replay.js'))).toEqual([])
  })

  test('one capture loads replay.js once; the thumbnail shows the masked email and the mark box', async ({ page }) => {
    const urls = trackNootedRequests(page)
    await setup(page)
    await page.locator('a[data-route="/checkout"]').click()
    await page.locator('#email').fill('alice.secret@example.com')
    await captureAfter(page, 'email ', '#email')

    await expect(host(page).locator('.frame.thumb iframe')).toBeVisible()
    const value = await thumbFrame(page).locator('#email').evaluate((el) => (el as HTMLInputElement).value)
    expect(value).toMatch(/^\*+$/)
    expect(urls.filter((u) => u.includes('replay.js'))).toHaveLength(1)

    // A second capture does not load it again.
    await captureAfter(page, '', '#password')
    await expect(host(page).locator('.frame.thumb iframe')).toHaveCount(2)
    expect(urls.filter((u) => u.includes('replay.js'))).toHaveLength(1)

    // The box is where the element is in the replayed frame.
    const boxes = host(page).locator('[data-nooted-card="1"] .cp-mark')
    await expect(boxes).toHaveCount(1)
    const box = (await boxes.boundingBox())!
    const target = (await thumbFrame(page).locator('#email').first().boundingBox())!
    expect(Math.abs(box.x - target.x)).toBeLessThan(4)
    expect(Math.abs(box.y - target.y)).toBeLessThan(4)
    expect(Math.abs(box.width - target.width)).toBeLessThan(4)
  })

  test('mark boxes line up when the page was scrolled at capture time', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => document.querySelector('#fx-tall')!.scrollIntoView())
    await page.evaluate(() => window.scrollBy(0, 200))
    await fab(page).click()
    await note(page).fill('x ')
    await pointButton(page).click()
    await mark(page, '#fx-tall p')
    await done(page)
    // Marking scrolls the element into view; whatever the scroll is at Done is what the capture records.
    expect((await draftCaptures(page))[0]!.scroll.y).toBeGreaterThan(100)
    await expect(host(page).locator('.frame.thumb iframe')).toBeVisible()
    const box = (await host(page).locator('.cp-mark').boundingBox())!
    const target = (await thumbFrame(page).locator('#fx-tall p').boundingBox())!
    expect(Math.abs(box.x - target.x)).toBeLessThan(4)
    expect(Math.abs(box.y - target.y)).toBeLessThan(4)
  })

  test('replay.js answering 500 leaves the text summary, and Send still works', async ({ page }) => {
    await seedRealToken(page)
    await page.route('**/sdk/v1/replay.js', (route) => route.fulfill({ status: 500, body: 'nope' }))
    const reports = await captureReports(page)
    await setup(page)
    await captureAfter(page, 'broken ', '#fx-counter')
    await expect(card(page, 1)).toContainText('Add to cart')
    await page.waitForTimeout(500)
    await expect(host(page).locator('.cp')).toHaveCount(0)
    await expect(card(page, 1).locator('.frame.placeholder')).toBeVisible()
    await page.keyboard.type('preview')
    const response = page.waitForResponse((r) => r.url().endsWith('/api/sdk/reports') && r.request().method() === 'POST')
    await host(page).getByRole('button', { name: 'Send', exact: true }).click()
    expect((await response).status()).toBe(201)
    expect(reports[0]!.captures).toHaveLength(1)
  })

  test('the enlarged view: Back and Escape return to the form with the note intact', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'see ', '#fx-counter')
    await page.keyboard.type('this')
    await openRow(page, 1).click()
    await expect(host(page).locator('.large iframe')).toBeVisible()
    await expect(host(page).locator('.large .cp-mark')).toHaveCount(1)
    await expect(note(page)).toHaveCount(0)

    await host(page).getByRole('button', { name: 'Back' }).click()
    await expect(note(page)).toHaveValue('see [1] this')

    await openRow(page, 1).click()
    await expect(host(page).locator('.large iframe')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeVisible()
    await expect(note(page)).toHaveValue('see [1] this')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
  })

  test('a demo capture can be played in the enlarged view', async ({ page }) => {
    await setup(page)
    await fab(page).click()
    await note(page).fill('menu ')
    await recordButton(page).click()
    await page.locator('#fx-menu-button').click()
    await expect(page.locator('#fx-menu')).toBeVisible()
    await page.waitForTimeout(400)
    await stopRecording(page)
    await expect(card(page, 1)).toContainText(/Recording0:0\d/)
    await openRow(page, 1).click()
    const play = host(page).getByRole('button', { name: 'Play demo' })
    await expect(play).toBeVisible()
    await play.click()
    await expect(host(page).getByRole('button', { name: 'Pause demo' })).toBeVisible()
    // It ends by itself and goes back to Play.
    await expect(play).toBeVisible({ timeout: 10_000 })
  })

  test('320 px with two cards: no horizontal scroll', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'a ', '#fx-counter')
    await captureAfter(page, 'b ', '#fx-icon')
    await expect(host(page).locator('.frame.thumb iframe')).toHaveCount(2)
    await page.setViewportSize({ width: 320, height: 640 })
    await expect(card(page, 2)).toBeVisible()
    await page.waitForTimeout(300)
    const overflow = await host(page).locator('.panel').evaluate((el) => ({ panel: el.scrollWidth - el.clientWidth, doc: document.documentElement.scrollWidth - window.innerWidth }))
    expect(overflow.panel).toBeLessThanOrEqual(0)
    expect(overflow.doc).toBeLessThanOrEqual(0)
    const cardBox = (await card(page, 2).boundingBox())!
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(320)
  })

  test('a CSP without inline styles shows the unstyled notice once, and a normal CSP does not', async ({ page }) => {
    await setup(page, '/?csp=strict-style')
    await captureAfter(page, 'csp ', '#fx-counter')
    await expect(host(page).getByText("Previews may look unstyled because of this site's security policy.")).toHaveCount(1)
  })

  test('without a style-blocking CSP there is no notice', async ({ page }) => {
    await setup(page, '/?csp=strict')
    await captureAfter(page, 'csp ', '#fx-counter')
    await expect(host(page).locator('.frame.thumb iframe')).toBeVisible()
    await page.waitForTimeout(2000)
    await expect(host(page).getByText(/may look unstyled/)).toHaveCount(0)
  })
})
