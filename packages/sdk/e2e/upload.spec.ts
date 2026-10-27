import { expect, test, type Page } from '@playwright/test'
import { PLAYGROUND_URL } from './env.ts'
import {
  captureReports,
  collectNootedLogs,
  debugNooted,
  enableNooted,
  fulfillStatus,
  interceptReports,
  listItems,
  readProject,
  seedRealToken,
  signInThroughPopup,
  waitForRuntime,
} from './helpers.ts'

const host = (page: Page) => page.locator('#nooted-host')
const fab = (page: Page) => host(page).getByRole('button', { name: 'Report a problem' })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Report a problem' })
const signInButton = (page: Page) => host(page).getByRole('button', { name: 'Sign in to Nooted' })
const note = (page: Page) => host(page).getByRole('textbox', { name: 'What went wrong?' })
const send = (page: Page) => host(page).getByRole('button', { name: 'Send', exact: true })
const badge = (page: Page) => host(page).locator('.badge')
const storedToken = (page: Page) => page.evaluate((k) => sessionStorage.getItem(`nooted:token:${k}`), readProject().key)

const unique = (label: string) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

test.beforeEach(async ({ page }) => {
  await debugNooted(page)
  await enableNooted(page)
})

async function start(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await waitForRuntime(page)
}

async function openAndSend(page: Page, text: string): Promise<void> {
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  await note(page).fill(text)
  await send(page).click()
}

const itemWithNote = async (text: string) => (await listItems()).filter((item) => item.note === text)

const fireOnline = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')))

test.describe('with a real token', () => {
  test.beforeEach(async ({ page }) => {
    await seedRealToken(page)
  })

  test('successful upload: gzipped, valid payload, 201, visible in the console API', async ({ page }) => {
    const reports = await captureReports(page)
    const response = page.waitForResponse((r) => r.url().endsWith('/api/sdk/reports') && r.request().method() === 'POST')
    const text = unique('success')
    await start(page)
    await openAndSend(page, text)
    expect((await response).status()).toBe(201)
    await expect(dialog(page)).toHaveCount(0)

    expect(reports).toHaveLength(1)
    const payload = reports[0]!
    expect(payload.note).toBe(text)
    expect(payload.clientReportId).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.events.length).toBeGreaterThan(0)
    expect(payload.url).toBe(`${PLAYGROUND_URL}/`)
    expect(payload.capturedAt).toBeGreaterThan(0)
    expect(payload.device.userAgent).toBeTruthy()
    await expect.poll(async () => (await itemWithNote(text)).length).toBe(1)
  })

  test('the report carries the URL at trigger time, not at send time', async ({ page }) => {
    const reports = await captureReports(page)
    await start(page, '/cart')
    await fab(page).click()
    await expect(dialog(page)).toBeVisible()
    await page.evaluate(() => history.pushState(null, '', '/checkout'))
    await note(page).fill(unique('url'))
    await send(page).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.url).toBe(`${PLAYGROUND_URL}/cart`)
  })

  test('offline: saved, badge shows 1, delivered without user action once back online', async ({ page, context }) => {
    const text = unique('offline')
    await start(page)
    await context.setOffline(true)
    await openAndSend(page, text)
    await expect(host(page).getByText('Saved — it will be sent automatically')).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)
    await expect(badge(page)).toHaveText('1')

    await context.setOffline(false)
    await expect(badge(page)).toHaveCount(0)
    await expect.poll(async () => (await itemWithNote(text)).length).toBe(1)
  })

  test('reload keeps the queue and it is retried after the SDK starts', async ({ page, context }) => {
    const text = unique('reload')
    const requests = await interceptReports(page, (route) => route.abort())
    await start(page)
    await context.setOffline(true)
    await openAndSend(page, text)
    await expect(badge(page)).toHaveText('1')
    await context.setOffline(false)
    await expect.poll(() => requests.length).toBeGreaterThan(0) // the online pass tried and failed

    await page.reload()
    await waitForRuntime(page)
    await expect(badge(page)).toHaveText('1')
    expect(await itemWithNote(text)).toHaveLength(0)

    await page.unroute('**/api/sdk/reports')
    await page.reload()
    await waitForRuntime(page)
    await expect(badge(page)).toHaveCount(0)
    await expect.poll(async () => (await itemWithNote(text)).length).toBe(1)
  })

  test('a lost response is retried with the same id, answered 200, and no duplicate is created', async ({ page }) => {
    const text = unique('lost')
    const statuses: number[] = []
    page.on('response', (r) => r.url().endsWith('/api/sdk/reports') && r.request().method() === 'POST' && statuses.push(r.status()))
    const requests = await interceptReports(page, async (route, n) => {
      if (n === 1) {
        await route.fetch() // the server stores it
        await route.abort() // the page never hears back
      } else {
        await route.continue()
      }
    })
    await start(page)
    await openAndSend(page, text)
    await expect(host(page).getByText('Saved — it will be sent automatically')).toBeVisible()
    await expect(badge(page)).toHaveText('1')
    await expect.poll(async () => (await itemWithNote(text)).length).toBe(1)

    await fireOnline(page)
    await expect(badge(page)).toHaveCount(0)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.payload.clientReportId).toBe(requests[0]!.payload.clientReportId)
    expect(statuses).toEqual([200])
    expect(await itemWithNote(text)).toHaveLength(1)
  })

  test('503 is retried at increasing intervals', async ({ page }) => {
    await page.clock.install()
    const requests = await interceptReports(page, (route) => fulfillStatus(route, 503))
    await start(page)
    await openAndSend(page, unique('backoff'))
    await expect(badge(page)).toHaveText('1')
    expect(requests).toHaveLength(1)

    const advance = async (ms: number) => {
      await page.clock.runFor(ms)
      await page.waitForTimeout(300)
    }
    // Retry 1 at 30 s.
    await advance(15_000)
    expect(requests).toHaveLength(1)
    await advance(25_000)
    expect(requests).toHaveLength(2)
    // Retry 2 another 60 s later.
    await advance(40_000)
    expect(requests).toHaveLength(2)
    await advance(30_000)
    expect(requests).toHaveLength(3)
    // Retry 3 another 120 s later.
    await advance(80_000)
    expect(requests).toHaveLength(3)
    await advance(60_000)
    expect(requests).toHaveLength(4)
    await expect(badge(page)).toHaveText('1')
  })

  test('413 is a permanent failure: warned once, not queued, not retried', async ({ page }) => {
    await page.clock.install()
    const logs = collectNootedLogs(page)
    const requests = await interceptReports(page, (route) => fulfillStatus(route, 413))
    await start(page)
    await openAndSend(page, unique('too big'))
    await expect(host(page).getByRole('alert')).toContainText("couldn't be sent")
    await expect(badge(page)).toHaveCount(0)
    expect(logs.filter((l) => l.type === 'warning' && l.text.includes('413'))).toHaveLength(1)

    await page.clock.runFor(3 * 3_600_000)
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(1)
    await expect(badge(page)).toHaveCount(0)
  })

  test('the 21st queued report drops the oldest with a warning', async ({ page, context }) => {
    const logs = collectNootedLogs(page)
    await start(page)
    const key = readProject().key
    await expect
      .poll(() => page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'nooted')))
      .toBe(true)
    await page.evaluate(
      async ({ key }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('nooted', 1)
          request.onupgradeneeded = () => request.result.createObjectStore('queue', { keyPath: 'clientReportId' })
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const tx = db.transaction('queue', 'readwrite')
        for (let i = 0; i < 20; i++) {
          tx.objectStore('queue').put({
            clientReportId: `seed-${i}`,
            projectKey: key,
            bytes: new Uint8Array([i]),
            createdAt: Date.now() - 60_000 + i,
          })
        }
        await new Promise((resolve) => (tx.oncomplete = resolve))
        db.close()
      },
      { key },
    )
    await context.setOffline(true)
    await openAndSend(page, unique('21st'))
    await expect(host(page).getByText('Saved — it will be sent automatically')).toBeVisible()
    await expect(badge(page)).toHaveText('20')
    expect(logs.filter((l) => l.type === 'warning' && l.text.includes('queue is full'))).toHaveLength(1)

    const ids = await page.evaluate(
      async () =>
        new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open('nooted', 1)
          open.onsuccess = () => {
            const request = open.result.transaction('queue').objectStore('queue').getAllKeys()
            request.onsuccess = () => resolve(request.result as string[])
            request.onerror = () => reject(request.error)
          }
        }),
    )
    expect(ids).toHaveLength(20)
    expect(ids).not.toContain('seed-0')
    expect(ids).toContain('seed-1')
  })

  test('badge shows the number of queued reports', async ({ page, context }) => {
    await start(page)
    await context.setOffline(true)
    await openAndSend(page, unique('first'))
    await expect(badge(page)).toHaveText('1')
    await expect(dialog(page)).toHaveCount(0)
    await openAndSend(page, unique('second'))
    await expect(badge(page)).toHaveText('2')
  })

  test('expired token while queued: stays queued, token forgotten, delivered after the next sign-in', async ({ page, context }) => {
    const text = unique('expired')
    const requests = await interceptReports(page, (route) => route.continue())
    await start(page)
    await context.setOffline(true)
    await openAndSend(page, text)
    await expect(badge(page)).toHaveText('1')
    await expect(dialog(page)).toHaveCount(0)
    await context.setOffline(false)
    await expect(badge(page)).toHaveCount(0) // delivered by the online pass; queue again below

    // Queue another one, this time with no valid token at all: nothing is sent and nothing prompts.
    const text2 = unique('expired-2')
    await context.setOffline(true)
    await openAndSend(page, text2)
    await expect(badge(page)).toHaveText('1')
    await page.evaluate((k) => sessionStorage.removeItem(`nooted:token:${k}`), readProject().key)
    const before = requests.length
    await context.setOffline(false)
    await page.waitForTimeout(500)
    expect(requests).toHaveLength(before)
    await expect(badge(page)).toHaveText('1')

    // A token the server rejects: 401, the token is forgotten, the report stays.
    await page.evaluate(
      (k) =>
        sessionStorage.setItem(
          `nooted:token:${k}`,
          JSON.stringify({ token: 'revoked-token', expiresAt: Date.now() + 3_600_000, user: { name: 'X', email: 'x@example.com' } }),
        ),
      readProject().key,
    )
    await fireOnline(page)
    await expect.poll(() => storedToken(page)).toBeNull()
    expect(requests).toHaveLength(before + 1)
    await expect(badge(page)).toHaveText('1')
    expect(await itemWithNote(text2)).toHaveLength(0)

    await fab(page).click()
    await expect(signInButton(page)).toBeVisible()
    await signInThroughPopup(page, 'admin@example.com')
    await expect(note(page)).toBeVisible({ timeout: 15_000 })
    await expect(badge(page)).toHaveCount(0)
    await expect.poll(async () => (await itemWithNote(text2)).length).toBe(1)
    expect(await itemWithNote(text)).toHaveLength(1)
  })
})
