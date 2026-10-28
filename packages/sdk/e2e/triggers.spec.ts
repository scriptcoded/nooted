import { expect, test, type Page } from '@playwright/test'
import { debugNooted, enableNooted, waitForRuntime } from './helpers.ts'

const fab = (page: Page) => page.locator('#nooted-host').getByRole('button', { name: 'Request a change' })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Request a change' })
const opened = (page: Page) => page.evaluate(() => document.documentElement.dataset.nootedOpened ?? '0')

test.beforeEach(async ({ page }) => {
  await enableNooted(page)
  await debugNooted(page)
})

/** Recent Chromium defines DeviceMotionEvent.requestPermission; remove it to get the "no permission needed" platform. */
async function noMotionPermission(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (DeviceMotionEvent as any).requestPermission
  })
}

/** Dispatches synthetic shake samples in real time (the handler reads event.timeStamp). */
async function shake(page: Page, bursts: number): Promise<void> {
  await page.evaluate(async (n) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const send = (x: number) =>
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y: 0, z: 9.8 }, interval: 16 }),
      )
    for (let i = 0; i < 10; i++) {
      send(0)
      await sleep(16)
    }
    for (let b = 0; b < n; b++) {
      send(30)
      await sleep(16)
      send(-30)
      await sleep(16)
      for (let i = 0; i < 6; i++) {
        send(0)
        await sleep(16)
      }
    }
  }, bursts)
}

test('a shake opens the report window, a walk does not', async ({ page }) => {
  await noMotionPermission(page)
  await page.goto('/')
  await waitForRuntime(page)
  // Gentle movement: nothing.
  await page.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: Math.sin(i / 3) * 3, y: 0, z: 9.8 }, interval: 16 }),
      )
      await new Promise((r) => setTimeout(r, 16))
    }
  })
  await expect(dialog(page)).toHaveCount(0)

  await shake(page, 4)
  await expect(dialog(page)).toBeVisible()
  expect(await opened(page)).toBe('1')
})

test('a shake works without a tap where requestPermission exists but needs no prompt (desktop Chromium)', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await shake(page, 4)
  await expect(dialog(page)).toBeVisible()
})

test('shakeThreshold can be overridden through init', async ({ page }) => {
  await noMotionPermission(page)
  await page.goto('/')
  await waitForRuntime(page)
  await page.evaluate(() => window.nooted?.init({ shakeThreshold: 1000 }))
  await shake(page, 4)
  await expect(dialog(page)).toHaveCount(0)
})

test('Ctrl+Shift+. opens the window; a second trigger keeps the first draft', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+Shift+.')
  await expect(dialog(page)).toBeVisible()
  const first = await page.evaluate(() => (window as any).__nootedDraft() as { openedAt: number; url: string })
  expect(first.openedAt).toBeGreaterThan(0)
  expect(first.url).toBe(page.url())

  await page.waitForTimeout(50)
  await page.keyboard.press('Control+Shift+.')
  await page.evaluate(() => window.nooted?.open())
  expect(await opened(page)).toBe('1')
  const second = await page.evaluate(() => (window as any).__nootedDraft() as { openedAt: number })
  expect(second.openedAt).toBe(first.openedAt)

  // Closing discards it; the next trigger starts a fresh draft.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await page.waitForTimeout(20)
  await page.keyboard.press('Control+Shift+.')
  await expect(dialog(page)).toBeVisible()
  expect(await opened(page)).toBe('2')
  const third = await page.evaluate(() => (window as any).__nootedDraft() as { openedAt: number })
  expect(third.openedAt).toBeGreaterThan(first.openedAt)
})

test('other shortcuts are left alone', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await page.keyboard.press('Shift+.')
  await page.keyboard.press('Control+.')
  await expect(dialog(page)).toHaveCount(0)
})

test('iOS permission is requested on the first tap only, and the window opens', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__permCalls = 0
    ;(DeviceMotionEvent as any).requestPermission = () => {
      ;(window as any).__permCalls++
      return Promise.resolve('granted')
    }
  })
  await page.goto('/')
  await waitForRuntime(page)
  // Not asked at load: iOS only allows the prompt inside a user gesture.
  expect(await page.evaluate(() => (window as any).__permCalls)).toBe(0)

  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  expect(await page.evaluate(() => (window as any).__permCalls)).toBe(1)
  expect(await page.evaluate(() => sessionStorage.getItem('nooted:motion'))).toBe('granted')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  expect(await page.evaluate(() => (window as any).__permCalls)).toBe(1)

  // Granted: shaking now works.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(20)
  await shake(page, 4)
  await expect(dialog(page)).toBeVisible()
})

test('denied permission: the button still opens the window, shaking does nothing', async ({ page }) => {
  await page.addInitScript(() => {
    ;(DeviceMotionEvent as any).requestPermission = () => Promise.resolve('denied')
  })
  await page.goto('/')
  await waitForRuntime(page)
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await shake(page, 4)
  await expect(dialog(page)).toHaveCount(0)
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
})

test('tapping the floating button opens the window', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  expect(await opened(page)).toBe('1')
})

test('dragging the button to the left edge persists across reloads, and a drag is not a tap', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  const button = fab(page)
  await expect(button).toBeVisible()
  const box = (await button.boundingBox())!
  const vw = page.viewportSize()!.width
  expect(box.x + box.width).toBeGreaterThan(vw - 40) // default: right side

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(vw / 2, box.y, { steps: 5 })
  await page.mouse.move(2, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(dialog(page)).toHaveCount(0)
  await expect.poll(async () => (await button.boundingBox())!.x).toBeLessThan(20)

  await page.reload()
  await waitForRuntime(page)
  await expect(button).toBeVisible()
  expect((await button.boundingBox())!.x).toBeLessThan(20)

  // Dragging far outside the viewport stays clamped.
  const b2 = (await button.boundingBox())!
  await page.mouse.move(b2.x + 20, b2.y + 20)
  await page.mouse.down()
  await page.mouse.move(-500, -500, { steps: 5 })
  await page.mouse.up()
  const b3 = (await button.boundingBox())!
  expect(b3.x).toBeGreaterThanOrEqual(0)
  expect(b3.y).toBeGreaterThanOrEqual(0)

  // Still a working button afterwards.
  await button.click()
  await expect(dialog(page)).toBeVisible()
})

test('init({ button: false }) hides the button but the shortcut still works', async ({ page }) => {
  await page.addInitScript(() => {
    // The loader defines window.nooted later; queue through its stub contract by waiting for it.
    const t = setInterval(() => {
      if (window.nooted) {
        window.nooted.init({ button: false })
        clearInterval(t)
      }
    }, 1)
  })
  await page.goto('/')
  await waitForRuntime(page)
  await expect(page.locator('#nooted-host')).toHaveCount(1)
  await expect(fab(page)).toHaveCount(0)
  await page.keyboard.press('Control+Shift+.')
  await expect(dialog(page)).toBeVisible()
})

test('init({ button: false }) after mount removes the button; true brings it back', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await expect(fab(page)).toBeVisible()
  await page.evaluate(() => window.nooted?.init({ button: false }))
  await expect(fab(page)).toHaveCount(0)
  await page.evaluate(() => window.nooted?.init({ button: true }))
  await expect(fab(page)).toBeVisible()
})

test('the pending badge shows the count when above zero', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await expect(fab(page)).toBeVisible()
  await page.evaluate(() => (window as any).__nootedSetPending(3))
  await expect(fab(page).locator('.badge')).toHaveText('3')
  await page.evaluate(() => (window as any).__nootedSetPending(0))
  await expect(fab(page).locator('.badge')).toHaveCount(0)
})
