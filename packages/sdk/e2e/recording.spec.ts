import { expect, test, type Page } from '@playwright/test'
import { enableNooted, waitForRuntime } from './helpers.ts'

interface RecordedEvent {
  type: number
  data: Record<string, any>
}

// Until group 7 the placeholder open() stores the frozen buffer on window when localStorage['nooted:test'] is '1'.
async function start(page: Page, path = '/checkout', afterAppRender = false): Promise<void> {
  await enableNooted(page)
  if (afterAppRender) {
    // The playground's module script (which un-hides the checkout section) can run after the first snapshot.
    // Hold the bundle until DOMContentLoaded so the snapshot sees the final layout.
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/sdk/v1/nooted.js', async (route) => {
      await gate
      await route.continue()
    })
    page.once('domcontentloaded', () => release())
  }
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nooted:test', '1')
    } catch {
      // No storage on about:blank.
    }
  })
  await page.goto(path)
  await waitForRuntime(page)
  // Recording starts right after takeover; wait for the first full snapshot.
  await page.waitForFunction(() => window.nooted?.t === true)
  await page.waitForTimeout(200)
}

// rrweb's input sampling 'last' emits a field's value on `change`, i.e. when it loses focus.
async function freeze(page: Page): Promise<RecordedEvent[]> {
  await page.evaluate(() => window.nooted?.open())
  await page.waitForFunction(() => '__nootedTestFrozen' in window)
  return page.evaluate(() => (window as any).__nootedTestFrozen as RecordedEvent[])
}

function find(node: any, test: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined
  if (test(node)) return node
  for (const child of Object.values(node)) {
    const hit = find(child, test)
    if (hit) return hit
  }
  return undefined
}

test('inputs are masked by default, and maskInputFn receives the element (show opt-out is recorded)', async ({ page }) => {
  await start(page)
  await page.locator('#email').fill('jane.doe@example.com')
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await page.locator('#password').fill('hunter2hunter2')
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await page.locator('#search').fill('red bicycle')
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  const text = JSON.stringify(await freeze(page))

  // The normal field is masked, the field inside data-nooted="show" is not: only possible if the element reaches maskInputFn.
  expect(text).not.toContain('jane.doe')
  expect(text).not.toContain('hunter2')
  expect(text).toContain('red bicycle')

  const events = JSON.parse(text) as RecordedEvent[]
  const inputs = events.filter((event) => event.type === 3 && event.data.source === 5).map((event) => event.data.text)
  expect(inputs).toContain('*'.repeat('jane.doe@example.com'.length))
  expect(inputs).toContain('red bicycle')
})

test('a password inside data-nooted="show" is still masked', async ({ page }) => {
  await start(page)
  await page.locator('#show-password').fill('swordfish-123')
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  const text = JSON.stringify(await freeze(page))
  expect(text).not.toContain('swordfish')
  expect(text).toContain('*'.repeat('swordfish-123'.length))
})

test('data-nooted="block" is recorded as a same-sized placeholder without content', async ({ page }) => {
  await start(page, '/checkout', true)
  const box = await page.locator('#card').boundingBox()
  const events = await freeze(page)
  expect(JSON.stringify(events)).not.toContain('Visa ending')

  const placeholder = find(events.find((event) => event.type === 2)?.data, (node) => node.attributes?.rr_width)
  // rrweb keeps only `class` on a blocked element, so the placeholder is the one node with rr_width.
  expect(placeholder).toBeTruthy()
  expect(placeholder.childNodes).toEqual([])
  expect(parseFloat(placeholder.attributes.rr_width)).toBeCloseTo(box!.width, -1)
  expect(parseFloat(placeholder.attributes.rr_height)).toBeCloseTo(box!.height, -1)
})

test('data-nooted="mask" text is replaced with asterisks', async ({ page }) => {
  await start(page)
  const text = JSON.stringify(await freeze(page))
  expect(text).not.toContain('SE45')
  expect(text).not.toContain('5000 0000')
  expect(text).toContain('**** **** **** **** **** ****')
})

test('the Nooted host element is never serialized with its content', async ({ page }) => {
  await start(page)
  // The real host is added in group 7. This documents the blockSelector rule with a stand-in.
  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'nooted-host'
    host.className = 'host-probe'
    host.textContent = 'NOOTED-SECRET-LABEL'
    document.body.append(host)
  })
  await page.waitForTimeout(300)
  const text = JSON.stringify(await freeze(page))
  // Only a placeholder (class and size) is recorded.
  const events = JSON.parse(text) as RecordedEvent[]
  const adds = events.flatMap((event) => (event.type === 3 ? (event.data.adds ?? []) : []))
  const placeholder = adds.find((add: any) => add.node?.attributes?.class === 'host-probe')?.node
  expect(placeholder?.attributes.rr_width).toBeDefined()
  expect(placeholder?.childNodes).toEqual([])
  expect(text).not.toContain('NOOTED-SECRET-LABEL')
})

test.describe('errors in the timeline', () => {
  const customErrors = (events: RecordedEvent[]) =>
    events.filter((event) => event.type === 5 && event.data.tag === 'nooted:error').map((event) => event.data.payload)

  test('an uncaught error becomes a nooted:error event with message and stack', async ({ page }) => {
    await start(page, '/')
    page.on('pageerror', () => {})
    await page.locator('#throw-error').click()
    const errors = customErrors(await freeze(page))
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('Playground: deliberate error')
    expect(errors[0].stack).toContain('Error')
    expect(typeof errors[0].time).toBe('number')
  })

  test('a rejection with a plain value is stringified', async ({ page }) => {
    await start(page, '/')
    await page.locator('#reject-promise').click()
    await page.waitForTimeout(200)
    const errors = customErrors(await freeze(page))
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('{"code":42}')
  })

  test('an error thrown before the bundle loads is replayed with its original time', async ({ page }) => {
    await enableNooted(page)
    await page.addInitScript(() => localStorage.setItem('nooted:test', '1'))
    page.on('pageerror', () => {})
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/sdk/v1/nooted.js', async (route) => {
      await gate
      await route.continue()
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const before = Date.now()
    await page.locator('#throw-error').click()
    const after = Date.now()
    await page.waitForTimeout(300)
    release()
    await waitForRuntime(page)
    await page.waitForTimeout(200)
    const errors = customErrors(await freeze(page))
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('Playground: deliberate error')
    expect(errors[0].time).toBeGreaterThanOrEqual(before - 50)
    expect(errors[0].time).toBeLessThanOrEqual(after + 50)
  })
})
