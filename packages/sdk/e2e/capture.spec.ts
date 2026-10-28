import { expect, test } from '@playwright/test'
import {
  bar,
  barButton,
  beginPoint,
  beginRecord,
  dialog,
  done,
  draftCaptures,
  fab,
  host,
  hovered,
  mark,
  marked,
  pointButton,
  recordButton,
  setup,
  snapshotNodes,
  stopRecording,
} from './capture-helpers.ts'
import { captureReports, seedRealToken } from './helpers.ts'

const count = (page: import('@playwright/test').Page) => page.locator('#fx-count').textContent()
const opened = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.dataset.nootedOpened)

test.describe('Point', () => {
  test('marking a button does not run its handler, and marks toggle', async ({ page }) => {
    await setup(page)
    await beginPoint(page)

    await mark(page, '#fx-counter')
    expect(await count(page)).toBe('0')
    await expect(marked(page)).toHaveCount(1)
    await expect(bar(page)).toContainText('1 selected')

    await mark(page, '#fx-icon')
    await expect(marked(page)).toHaveCount(2)
    await expect(bar(page)).toContainText('2 selected')

    // Unmark.
    await mark(page, '#fx-counter')
    await expect(marked(page)).toHaveCount(1)
    await expect(bar(page)).toContainText('1 selected')
    expect(await count(page)).toBe('0')
  })

  test('the window and the floating button are hidden, the bar is shown', async ({ page }) => {
    await setup(page)
    await expect(fab(page)).toBeVisible()
    await beginPoint(page)
    await expect(dialog(page)).toHaveCount(0)
    await expect(fab(page)).toHaveCount(0)
    await expect(bar(page)).toContainText('Tap what you mean')
    for (const name of ['Cancel', 'Done']) await expect(barButton(page, name)).toBeVisible()
    await expect(barButton(page, 'Stop')).toHaveCount(0)
    await expect(bar(page)).not.toContainText('selected')
    // The host stays 0x0 and click-through.
    const box = await page.locator('#nooted-host').boundingBox()
    expect(box).toMatchObject({ width: 0, height: 0 })
    expect(await page.locator('#nooted-host').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
  })

  test('the keyboard shortcut is ignored during Point, and nooted.open() too', async ({ page }) => {
    await setup(page)
    await beginPoint(page)
    const before = await opened(page)
    await page.keyboard.press('Control+Shift+.')
    await page.evaluate(() => window.nooted.open())
    await page.waitForTimeout(100)
    expect(await opened(page)).toBe(before)
    await expect(dialog(page)).toHaveCount(0)
    await expect(bar(page)).toBeVisible()
  })

  test('a mouse hover outlines the element under the pointer', async ({ page }) => {
    await setup(page)
    await beginPoint(page)
    const target = page.locator('#fx-counter')
    const box = (await target.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(hovered(page)).toHaveCount(1)
    await page.mouse.move(2, 2)
    await expect(hovered(page)).toHaveCount(0)
  })

  test('scrolling while marking keeps highlights on their elements', async ({ page }) => {
    await setup(page)
    await beginPoint(page)
    await mark(page, '#fx-counter')
    await mark(page, '#fx-name')
    await expect(marked(page)).toHaveCount(2)

    await page.mouse.move(600, 300)
    await page.mouse.wheel(0, 250)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)

    for (const [i, selector] of ['#fx-counter', '#fx-name'].entries()) {
      await expect
        .poll(async () => {
          const el = (await page.locator(selector).boundingBox())!
          const hl = (await marked(page).nth(i).boundingBox())!
          return Math.max(Math.abs(el.x - hl.x), Math.abs(el.y - hl.y), Math.abs(el.width - hl.width), Math.abs(el.height - hl.height))
        })
        .toBeLessThanOrEqual(1)
    }
  })

  test('Cancel returns to the window and adds nothing', async ({ page }) => {
    await setup(page)
    await beginPoint(page)
    await mark(page, '#fx-icon')
    await barButton(page, 'Cancel').click()
    await expect(bar(page)).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
    await expect(marked(page)).toHaveCount(0)
    expect(await draftCaptures(page)).toEqual([])
    // Page clicks work again (the window is a modal, so close it first).
    await host(page).getByRole('button', { name: 'Cancel' }).click()
    await page.locator('#fx-counter').click()
    expect(await count(page)).toBe('1')
  })

  test('turning Nooted off during capture removes the interception', async ({ page }) => {
    await setup(page)
    await beginPoint(page)
    await mark(page, '#fx-counter')
    expect(await count(page)).toBe('0')
    await page.evaluate(() => window.nooted.disable())
    await expect(page.locator('#nooted-host')).toHaveCount(0)
    await page.locator('#fx-counter').click()
    expect(await count(page)).toBe('1')
  })


  test('Done with nothing selected adds a whole-page capture', async ({ page }) => {
    await setup(page)
    await beginPoint(page)
    await done(page)
    const [capture] = await draftCaptures(page)
    expect(capture).toMatchObject({ n: 1, demo: false, marks: [] })
    await expect(host(page).locator('[data-nooted-card="1"]')).toContainText('Whole page')
  })

  test('Escape cancels, and the page does not see it', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      ;(window as unknown as { __keys: string[] }).__keys = []
      window.addEventListener('keydown', (e) => (window as unknown as { __keys: string[] }).__keys.push(e.key))
    })
    await beginPoint(page)
    await mark(page, '#fx-counter')
    await page.keyboard.press('Escape')
    await expect(bar(page)).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
    expect(await draftCaptures(page)).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { __keys: string[] }).__keys)).not.toContain('Escape')
  })
})

test.describe('captures', () => {
  test('snapshot only: Meta then FullSnapshot, marks with node ids, an empty host placeholder', async ({ page }) => {
    await setup(page)
    await beginPoint(page)
    await mark(page, '#fx-counter')
    await mark(page, '#fx-name')
    await done(page)

    // Back in the window with the capture listed.
    await expect(dialog(page)).toBeVisible()
    await expect(host(page).locator('[data-nooted-card="1"]')).toContainText('[1]Pointed atAdd to cart, Full name')

    const [capture, ...rest] = await draftCaptures(page)
    expect(rest).toEqual([])
    expect(capture).toMatchObject({ n: 1, demo: false, url: page.url() })
    expect(capture!.events.map((e) => e.type).slice(0, 2)).toEqual([4, 2])
    expect(capture!.marks).toHaveLength(2)
    expect(capture!.viewport).toEqual({ width: 1280, height: 720 })
    for (const m of capture!.marks) expect(m.nodeId).toBeGreaterThan(0)

    // The marked button's node id points at the button in the snapshot.
    const button = snapshotNodes(capture!.events, (n) => n.attributes?.id === 'fx-counter')
    expect(button.map((n) => n.id)).toEqual([capture!.marks[0]!.nodeId])

    // The host is a blocked placeholder, 0x0, with no Nooted UI inside.
    const sized = snapshotNodes(capture!.events, (n) => n.attributes?.rr_width !== undefined)
    expect(sized.some((n) => n.attributes?.rr_width === '0px' && n.attributes?.rr_height === '0px')).toBe(true)
    const json = JSON.stringify(capture!.events)
    for (const text of ['Tap what you mean', 'Point at something', 'Record a demo', 'nooted-host']) expect(json).not.toContain(text)
    expect(json).not.toContain('data-nooted-highlight')
  })

  test('the capture is accepted by the server when sent', async ({ page }) => {
    await seedRealToken(page)
    const reports = await captureReports(page)
    await setup(page)
    await beginPoint(page)
    await mark(page, '#fx-counter')
    await done(page)
    await host(page).getByRole('textbox', { name: 'What should change?' }).fill('The button is wrong')
    const response = page.waitForResponse((r) => r.url().endsWith('/api/sdk/reports') && r.request().method() === 'POST')
    await host(page).getByRole('button', { name: 'Send', exact: true }).click()
    expect((await response).status()).toBe(201)
    expect(reports[0]!.captures).toHaveLength(1)
    expect(reports[0]!.captures[0]!.marks[0]).toMatchObject({ tag: 'button', name: 'Add to cart' })
  })

  test('masking applies in captures', async ({ page }) => {
    await setup(page, '/checkout')
    await expect(page.locator('#email')).toBeVisible()
    await page.locator('#email').fill('jane.doe@example.com')
    await page.locator('#password').fill('hunter2hunter2')
    await page.locator('#search').fill('red bicycle')
    await page.locator('#show-password').fill('swordfish-123')
    await beginPoint(page)
    await done(page)

    const [capture] = await draftCaptures(page)
    const value = (id: string) => snapshotNodes(capture!.events, (n) => n.attributes?.id === id)[0]?.attributes?.value
    expect(value('email')).toBe('*'.repeat('jane.doe@example.com'.length))
    expect(value('password')).toBe('*'.repeat('hunter2hunter2'.length))
    expect(value('search')).toBe('red bicycle')
    expect(value('show-password')).toBe('*'.repeat('swordfish-123'.length))

    // The block element is a sized placeholder with no content.
    const card = snapshotNodes(capture!.events, (n) => n.attributes?.rr_width !== undefined && n.attributes.rr_width !== '0px')
    expect(card).toHaveLength(1)
    expect(Number.parseInt(String(card[0]!.attributes!.rr_width))).toBeGreaterThan(0)
    expect(card[0]!.childNodes ?? []).toEqual([])

    const json = JSON.stringify(capture!.events)
    for (const secret of ['jane.doe', 'hunter2', 'swordfish', 'Visa', '4242', 'SE45', '5000 0000']) expect(json).not.toContain(secret)
    // Masked text keeps its shape as asterisks.
    const account = snapshotNodes(capture!.events, (n) => n.attributes?.id === 'account-number')[0]!
    expect(account.childNodes!.map((c) => c.textContent).join('')).toMatch(/^[* ]+$/)
  })
})

test.describe('Record', () => {
  test('the bar shows the timer, and the page stays fully interactive', async ({ page }) => {
    await setup(page)
    await beginRecord(page)
    await expect(dialog(page)).toHaveCount(0)
    await expect(fab(page)).toHaveCount(0)
    await expect(bar(page)).toContainText(/Recording 0:0\d/)
    await expect(bar(page)).toContainText('Use the page')
    for (const name of ['Cancel', 'Stop']) await expect(barButton(page, name)).toBeVisible()
    await expect(barButton(page, 'Done')).toHaveCount(0)
    await expect(marked(page)).toHaveCount(0)

    // Clicks reach the page, nothing is intercepted and nothing is marked.
    await page.locator('#fx-counter').click()
    expect(await count(page)).toBe('1')
    await expect(marked(page)).toHaveCount(0)
  })

  test('record, open the menu, stop: a demo capture without marks that ends with the menu open', async ({ page }) => {
    await setup(page)
    await fab(page).click()
    await recordButton(page).click()
    await expect(bar(page)).toContainText('Recording')

    await page.locator('#fx-menu-button').click()
    await expect(page.locator('#fx-menu')).toBeVisible()
    await page.waitForTimeout(300)
    await stopRecording(page)
    await expect(dialog(page)).toBeVisible()

    const [capture, ...rest] = await draftCaptures(page)
    expect(rest).toEqual([])
    expect(capture).toMatchObject({ n: 1, demo: true, marks: [] })
    expect(capture!.events.map((e) => e.type).slice(0, 2)).toEqual([4, 2])
    const last = capture!.events.at(-1)!
    expect(last.type).toBe(2)
    expect(capture!.events.slice(2, -2).some((e) => e.type === 3)).toBe(true)
    const menu = snapshotNodes([last] as typeof capture.events, (n) => n.attributes?.id === 'fx-menu')[0]!
    expect(menu.attributes).not.toHaveProperty('hidden')
    // None of Nooted's UI ends up in the clip.
    const json = JSON.stringify(capture!.events)
    for (const text of ['Recording', 'Use the page', 'nooted-host']) expect(json).not.toContain(text)
    await expect(host(page).locator('[data-nooted-card="1"]')).toContainText(/Recording0:0\d/)
  })

  test('Escape cancels the recording, and the page does not see it', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      ;(window as unknown as { __keys: string[] }).__keys = []
      window.addEventListener('keydown', (e) => (window as unknown as { __keys: string[] }).__keys.push(e.key))
    })
    await beginRecord(page)
    await page.keyboard.press('Escape')
    await expect(bar(page)).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
    expect(await draftCaptures(page)).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { __keys: string[] }).__keys)).not.toContain('Escape')
  })

  test('Cancel returns to the window and adds nothing', async ({ page }) => {
    await setup(page)
    await beginRecord(page)
    await page.locator('#fx-counter').click()
    await barButton(page, 'Cancel').click()
    await expect(bar(page)).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
    expect(await draftCaptures(page)).toEqual([])
  })

  test('the keyboard shortcut is ignored during Record, and nooted.open() too', async ({ page }) => {
    await setup(page)
    await beginRecord(page)
    const before = await opened(page)
    await page.keyboard.press('Control+Shift+.')
    await page.evaluate(() => window.nooted.open())
    await page.waitForTimeout(100)
    expect(await opened(page)).toBe(before)
    await expect(dialog(page)).toHaveCount(0)
    await expect(bar(page)).toBeVisible()
  })

  test('an error during the recording is captured, errors outside it are not', async ({ page }) => {
    await setup(page)
    // Before recording (window open): nothing is listening.
    await page.evaluate(() => setTimeout(() => { throw new Error('before recording') }, 0))
    await page.waitForTimeout(100)
    await beginRecord(page)
    await page.locator('#throw-error').click()
    await page.evaluate(() => void Promise.reject(new Error('rejected in recording')))
    await page.waitForTimeout(150)
    await stopRecording(page)
    await page.evaluate(() => setTimeout(() => { throw new Error('after recording') }, 0))
    await page.waitForTimeout(150)

    const [capture] = await draftCaptures(page)
    const errors = capture!.events.filter((e) => e.type === 5 && (e.data as { tag?: string }).tag === 'nooted:error')
    const messages = errors.map((e) => (e.data as { payload: { message: string } }).payload.message)
    expect(messages.some((m) => m.includes('deliberate error from a click handler'))).toBe(true)
    expect(messages.some((m) => m.includes('rejected in recording'))).toBe(true)
    expect(messages.join('|')).not.toContain('before recording')
    expect(messages.join('|')).not.toContain('after recording')
    expect(errors.every((e) => !JSON.stringify(e).includes('/sdk/v1/'))).toBe(true)
  })

  test('a recording stops by itself after 60 seconds and is added', async ({ page }) => {
    await page.clock.install()
    await setup(page)
    await beginRecord(page)
    await page.clock.runFor(55_000)
    await expect(barButton(page, 'Stop')).toBeVisible()
    await expect(bar(page)).toContainText('0:55')
    await page.clock.runFor(6_000)
    await expect(bar(page)).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
    const [capture] = await draftCaptures(page)
    expect(capture).toMatchObject({ n: 1, demo: true, marks: [] })
    expect(capture!.events.at(-1)!.type).toBe(2)
  })

  test('turning Nooted off during a recording cleans up', async ({ page }) => {
    await setup(page)
    await beginRecord(page)
    await page.evaluate(() => window.nooted.disable())
    await expect(page.locator('#nooted-host')).toHaveCount(0)
    await page.locator('#fx-counter').click()
    expect(await count(page)).toBe('1')
  })
})

test('Point and Record are not offered before the window is open', async ({ page }) => {
  await setup(page)
  await expect(pointButton(page)).toHaveCount(0)
  await expect(recordButton(page)).toHaveCount(0)
})
