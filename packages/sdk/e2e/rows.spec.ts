import { expect, test, type Page } from '@playwright/test'
import { bar, captureAfter, dialog, done, draftCaptures, fab, host, note, pointButton, recordButton, setup, stopRecording } from './capture-helpers.ts'
import { captureReports, seedRealToken } from './helpers.ts'

const card = (page: Page, n: number) => host(page).locator(`[data-nooted-card="${n}"]`)
const tile = (page: Page, n: number) => card(page, n).locator('.frame.thumb')

async function addWholePage(page: Page): Promise<void> {
  await pointButton(page).click()
  await expect(bar(page)).toBeVisible()
  await done(page)
}

async function addRecording(page: Page): Promise<void> {
  await recordButton(page).click()
  await expect(bar(page)).toContainText('Recording')
  await page.locator('#fx-menu-button').click()
  await page.waitForTimeout(500)
  await stopRecording(page)
}

test.describe('capture rows', () => {
  test('a point thumbnail frames the selected element inside the 96x64 tile', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'x ', '#fx-counter')
    await expect(tile(page, 1).locator('iframe')).toBeVisible()
    const t = (await tile(page, 1).boundingBox())!
    expect(t.width).toBe(96)
    expect(t.height).toBe(64)
    const el = (await page.frameLocator('#nooted-host [data-nooted-card="1"] iframe').locator('#fx-counter').boundingBox())!
    expect(el.x).toBeGreaterThanOrEqual(t.x - 0.5)
    expect(el.y).toBeGreaterThanOrEqual(t.y - 0.5)
    expect(el.x + el.width).toBeLessThanOrEqual(t.x + t.width + 0.5)
    expect(el.y + el.height).toBeLessThanOrEqual(t.y + t.height + 0.5)
    expect(Math.abs(el.x + el.width / 2 - (t.x + t.width / 2))).toBeLessThan(t.width * 0.2)
    expect(Math.abs(el.y + el.height / 2 - (t.y + t.height / 2))).toBeLessThan(t.height * 0.2)
    // The selected rect is drawn on top of the element.
    const box = (await card(page, 1).locator('.cp-mark').boundingBox())!
    expect(Math.abs(box.x - el.x)).toBeLessThan(2)
    expect(Math.abs(box.width - el.width)).toBeLessThan(2)
    await expect(card(page, 1).locator('.cp-badge')).toHaveCount(0)
  })

  test('a whole-page capture fills the tile', async ({ page }) => {
    await setup(page)
    await fab(page).click()
    await note(page).fill('x ')
    await addWholePage(page)
    await expect(card(page, 1)).toContainText('Whole page')
    await expect(tile(page, 1).locator('iframe')).toBeVisible()
    const t = (await tile(page, 1).boundingBox())!
    const w = (await tile(page, 1).locator('.replayer-wrapper').boundingBox())!
    expect(w.x).toBeLessThanOrEqual(t.x + 0.5)
    expect(w.y).toBeLessThanOrEqual(t.y + 0.5)
    expect(w.x + w.width).toBeGreaterThanOrEqual(t.x + t.width - 0.5)
    expect(w.y + w.height).toBeGreaterThanOrEqual(t.y + t.height - 0.5)
    await expect(card(page, 1).locator('.cp-mark')).toHaveCount(0)
  })

  test('a recording row shows its duration, a play glyph and where it ends', async ({ page }) => {
    await setup(page)
    await fab(page).click()
    await note(page).fill('demo ')
    await addRecording(page)
    await expect(card(page, 1)).toContainText(/\[1\]Recording0:0\d · Ends on \//)
        await expect(card(page, 1).locator('.tile-dur')).toHaveText(/^0:0\d$/)
    await expect(card(page, 1).locator('.tile-play')).toBeVisible()
  })

  test('without the player: placeholder tiles with the right icons, text unchanged, Send works', async ({ page }) => {
    await seedRealToken(page)
    await page.route('**/sdk/v1/replay.js', (route) => route.fulfill({ status: 500, body: 'nope' }))
    const reports = await captureReports(page)
    await setup(page)
    await captureAfter(page, 'a ', '#fx-counter')
    await addRecording(page)
    await page.waitForTimeout(500)
    await expect(card(page, 1).locator('.placeholder svg.stroke')).toBeVisible()
    await expect(card(page, 2).locator('.placeholder svg.rec')).toBeVisible()
    await expect(card(page, 1)).toContainText('Add to cart')
    await expect(card(page, 2)).toContainText(/Recording0:0\d/)
    await expect(host(page).locator('iframe')).toHaveCount(0)
    await page.keyboard.press('Control+End')
    await note(page).click()
    await page.keyboard.type('end')
    const response = page.waitForResponse((r) => r.url().endsWith('/api/sdk/reports') && r.request().method() === 'POST')
    await host(page).getByRole('button', { name: 'Send', exact: true }).click()
    expect((await response).status()).toBe(201)
    expect(reports[0]!.captures).toHaveLength(2)
  })

  test('the large view opens by click and by keyboard; Back and Escape return with the note intact', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'see ', '#fx-counter')
    await page.keyboard.type('this')

    await card(page, 1).locator('.row-main').click()
    await expect(host(page).locator('.large iframe')).toBeVisible()
    await expect(host(page).locator('.large')).toContainText(/\[1\]Screenshot of \S/)
    await expect(host(page).locator('.large .cp-badge')).toHaveCount(1)
    await expect(note(page)).toHaveCount(0)
    await host(page).getByRole('button', { name: 'Back' }).click()
    await expect(note(page)).toHaveValue('see [1] this')

    const row = card(page, 1).locator('.row-main')
    await row.focus()
    await expect(row).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(host(page).locator('.large iframe')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(note(page)).toHaveValue('see [1] this')
    await row.focus()
    await page.keyboard.press('Space')
    await expect(host(page).locator('.large iframe')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeVisible()
    await expect(note(page)).toHaveValue('see [1] this')
  })

  test('a recording plays in the large view and ends on the final frame', async ({ page }) => {
    await setup(page)
    await fab(page).click()
    await note(page).fill('demo ')
    await addRecording(page)
    await card(page, 1).locator('.row-main').click()
    await expect(host(page).locator('.large')).toContainText(/\[1\]Recording · 0:0\d/)
    const play = host(page).getByRole('button', { name: 'Play demo' })
    await play.click()
    await expect(host(page).getByRole('button', { name: 'Pause demo' })).toBeVisible()
    await expect(play).toBeVisible({ timeout: 10_000 })
  })

  test('the x button removes the row and its token', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'a ', '#fx-counter')
    await captureAfter(page, 'b ', '#fx-icon')
    await host(page).getByRole('button', { name: 'Remove capture 1' }).click()
    await expect(card(page, 1)).toHaveCount(0)
    await expect(card(page, 2)).toBeVisible()
    await expect(note(page)).toHaveValue('a b [2] ')
    expect((await draftCaptures(page)).map((c) => c.n)).toEqual([2])
    const x = (await host(page).getByRole('button', { name: 'Remove capture 2' }).boundingBox())!
    expect(x.width).toBeGreaterThanOrEqual(32)
    expect(x.height).toBeGreaterThanOrEqual(32)
  })

  test('every row is exactly two single-line text lines at 320 px', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'a ', '#fx-counter')
    await addWholePage(page)
    await addRecording(page)
    await page.setViewportSize({ width: 320, height: 700 })
    await expect(card(page, 3)).toBeVisible()
    for (const n of [1, 2, 3]) {
      const lines = await card(page, n).locator('.row-text').evaluate((el) => {
        const out = [...el.children].map((child) => {
          const rects = [...child.children].map((c) => c.getBoundingClientRect())
          const own = child.getBoundingClientRect()
          // One line: the line's box is one line-height tall and its children share a top edge.
          return { height: own.height, tops: new Set(rects.map((r) => Math.round(r.top))).size, overflow: child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).textOverflow !== 'ellipsis' }
        })
        return out
      })
      expect(lines).toHaveLength(2)
      for (const line of lines) {
        expect(line.height).toBeLessThanOrEqual(20)
        expect(line.tops).toBeLessThanOrEqual(1)
        expect(line.overflow).toBe(false)
      }
    }
    await expect(card(page, 3).locator('.row-line1')).toHaveText(/^\[3\]Recording$/)
    await expect(card(page, 2).locator('.row-line2')).toHaveText('Whole page')
  })

  test('whole-page and recording thumbnails cover the tile, anchored to the top', async ({ page }) => {
    await setup(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await fab(page).click()
    await note(page).fill('x ')
    await addWholePage(page)
    await addRecording(page)
    for (const n of [1, 2]) {
      await expect(tile(page, n).locator('iframe')).toBeVisible()
      const t = (await tile(page, n).boundingBox())!
      const w = (await tile(page, n).locator('.replayer-wrapper').boundingBox())!
      // The wrapper fills the tile's width (it may overhang), starts at the top edge and is taller than the tile.
      expect(w.x).toBeLessThanOrEqual(t.x + 0.5)
      expect(w.x + w.width).toBeGreaterThanOrEqual(t.x + t.width - 0.5)
      expect(Math.abs(w.y - t.y)).toBeLessThan(0.5)
      expect(w.height).toBeGreaterThan(t.height)
    }
  })

  test('the large view widens the panel on desktop and toggles between the selection and the whole page', async ({ page }) => {
    await setup(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await captureAfter(page, 'see ', '#fx-counter')
    const panelWidth = async () => (await host(page).locator('.panel').boundingBox())!.width
    expect(await panelWidth()).toBeLessThanOrEqual(440)
    await card(page, 1).locator('.row-main').click()
    await expect(host(page).locator('.large iframe')).toBeVisible()
    await expect.poll(panelWidth).toBeGreaterThan(900)
    const wrapper = host(page).locator('.large .replayer-wrapper')
    const element = page.frameLocator('#nooted-host .large iframe').locator('#fx-counter')
    // Zoomed: the selected element is shown at a legible scale, with its selection box on top of it.
    await expect.poll(async () => (await element.boundingBox())!.width).toBeGreaterThan(40)
    const zoomedScale = (await wrapper.boundingBox())!.width / 1280
    expect(zoomedScale).toBeGreaterThan(0.7)
    const markBox = (await host(page).locator('.large .cp-mark').boundingBox())!
    const elBox = (await element.boundingBox())!
    expect(Math.abs(markBox.x - elBox.x)).toBeLessThan(3)
    const toggle = host(page).getByRole('button', { name: 'Show whole page' })
    await toggle.click()
    await expect(host(page).getByRole('button', { name: 'Zoom to selection' })).toBeVisible()
    await expect.poll(async () => (await wrapper.boundingBox())!.width).toBeGreaterThan(700)
    const frame = (await host(page).locator('.large .frame').boundingBox())!
    const whole = (await wrapper.boundingBox())!
    expect(whole.width).toBeLessThanOrEqual(frame.width + 0.5)
    expect(whole.height).toBeLessThanOrEqual(frame.height + 1)
    expect(frame.height).toBeLessThanOrEqual(800 * 0.7 + 1)
    await host(page).getByRole('button', { name: 'Zoom to selection' }).click()
    await expect(host(page).getByRole('button', { name: 'Show whole page' })).toBeVisible()
    await host(page).getByRole('button', { name: 'Back' }).click()
    await expect.poll(panelWidth).toBeLessThanOrEqual(440)
  })

  test('the large view title names what was pointed at; no zoom toggle without selections or for recordings', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'a ', '#fx-counter')
    await addWholePage(page)
    await addRecording(page)
    await card(page, 2).locator('.row-main').click()
    await expect(host(page).locator('.large-title')).toContainText('[2]Screenshot of the whole page')
    await expect(host(page).locator('.large .zoom')).toHaveCount(0)
    await host(page).getByRole('button', { name: 'Back' }).click()
    await card(page, 3).locator('.row-main').click()
    await expect(host(page).locator('.large-title')).toContainText(/\[3\]Recording · 0:0\d/)
    await expect(host(page).locator('.large .zoom')).toHaveCount(0)
  })

  test('320 px with three rows: no horizontal scroll, nothing overflows its row', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'a ', '#fx-counter')
    await addWholePage(page)
    await addRecording(page)
    await page.setViewportSize({ width: 320, height: 700 })
    await expect(card(page, 3)).toBeVisible()
    await page.waitForTimeout(300)
    const overflow = await host(page).locator('.panel').evaluate((el) => ({ panel: el.scrollWidth - el.clientWidth, doc: document.documentElement.scrollWidth - window.innerWidth }))
    expect(overflow.panel).toBeLessThanOrEqual(0)
    expect(overflow.doc).toBeLessThanOrEqual(0)
    for (const n of [1, 2, 3]) {
      const row = (await card(page, n).boundingBox())!
      expect(row.x + row.width).toBeLessThanOrEqual(320)
      for (const part of ['.frame.thumb', '.row-text', '.row-remove']) {
        const b = (await card(page, n).locator(part).boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(row.x)
        expect(b.x + b.width).toBeLessThanOrEqual(row.x + row.width + 0.5)
        expect(b.y).toBeGreaterThanOrEqual(row.y)
        expect(b.y + b.height).toBeLessThanOrEqual(row.y + row.height + 0.5)
      }
    }
  })
})

test.describe('floating button', () => {
  test('is hidden while the window is open, and focus returns to it after close', async ({ page }) => {
    await setup(page)
    await expect(fab(page)).toBeVisible()
    await fab(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(fab(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(fab(page)).toBeVisible()
    await expect(fab(page)).toBeFocused()
  })

  test('stays hidden through a capture and comes back after the window closes', async ({ page }) => {
    await setup(page)
    await captureAfter(page, 'x ', '#fx-counter')
    await expect(fab(page)).toHaveCount(0)
    await host(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(fab(page)).toBeFocused()
  })
})
