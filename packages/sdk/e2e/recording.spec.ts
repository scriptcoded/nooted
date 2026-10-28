import { expect, test, type Page } from '@playwright/test'
import { captureReports, enableNooted, seedRealToken, waitForRuntime, debugNooted } from './helpers.ts'

// Nothing records in the background. rrweb only runs during a capture session; the masking and
// privacy tests for captures live in capture.spec.ts.

const spy = () => {
  const seen: string[] = []
  ;(window as any).__recorderListeners = seen
  const add = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: [any, any?]) {
    // Playwright adds mouse and touch listeners of its own while it clicks.
    if ((this === document || this === window) && !new Error().stack!.includes('HitTargetInterceptor')) seen.push(type)
    return add.call(this, type, ...rest)
  }
}
const recorderListeners = (page: Page) =>
  page.evaluate(() =>
    ((window as any).__recorderListeners as string[])
      .filter((t) => ['mousemove', 'touchmove', 'scroll', 'input', 'mouseup', 'touchend'].includes(t))
      .sort(),
  )

test('with Nooted enabled and the window open, rrweb does not record', async ({ page, browser }) => {
  // rrweb listens for mouse, touch, scroll and input events as soon as record() starts. The dev server's own
  // scripts add some too, so compare with a page that has Nooted off.
  const plain = await (await browser.newContext()).newPage()
  await plain.addInitScript(spy)
  await plain.goto('/')
  await plain.waitForLoadState('load')
  const baseline = await recorderListeners(plain)
  await plain.context().close()

  await enableNooted(page)
  await debugNooted(page)
  await seedRealToken(page)
  await page.addInitScript(spy)
  const reports = await captureReports(page)
  await page.goto('/')
  await waitForRuntime(page)

  await page.keyboard.press('Control+Shift+.')
  await expect(page.locator('#nooted-host').getByRole('dialog')).toBeVisible()
  await page.evaluate(() => {
    for (let i = 0; i < 50; i++) document.body.append(Object.assign(document.createElement('p'), { textContent: `row ${i}` }))
    window.scrollTo(0, 50)
  })
  await page.mouse.move(100, 100)
  await page.mouse.move(150, 160)
  await page.waitForTimeout(300)

  expect(await recorderListeners(page)).toEqual(baseline)

  await page.locator('#nooted-host').getByRole('textbox', { name: 'What should change?' }).fill('text only')
  await page.locator('#nooted-host').getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => reports.length).toBe(1)
  expect(reports[0]).toMatchObject({ note: 'text only', captures: [] })
  expect(reports[0]).not.toHaveProperty('events')
  expect(reports[0]).not.toHaveProperty('recording')
})
