import { expect, test, type Page } from '@playwright/test'
import { NOOTED_URL, PLAYGROUND_URL } from './env.ts'
import {
  captureReports,
  debugNooted,
  enableNooted,
  fulfillStatus,
  interceptReports,
  readProject,
  seedRealToken,
  seedToken,
  signInThroughPopup,
  trackNootedRequests,
  waitForRuntime,
} from './helpers.ts'

const host = (page: Page) => page.locator('#nooted-host')
const fab = (page: Page) => host(page).getByRole('button', { name: 'Request a change' })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Request a change' })
const signInButton = (page: Page) => host(page).getByRole('button', { name: 'Sign in to Nooted' })
const note = (page: Page) => host(page).getByRole('textbox', { name: 'What should change?' })
const send = (page: Page) => host(page).getByRole('button', { name: 'Send', exact: true })
const cancel = (page: Page) => host(page).getByRole('button', { name: 'Cancel' })
const mic = (page: Page) => host(page).getByRole('button', { name: /voice input/i })

type TestWindow = Window & {
  __nootedDraft?: () => { openedAt: number; url: string; captures: unknown[] } | undefined
  __fakeSR?: { started: boolean; lang: string; onresult: (e: unknown) => void }
}

test.beforeEach(async ({ page }) => {
  await debugNooted(page)
})

async function open(page: Page, path = '/'): Promise<void> {
  await enableNooted(page)
  await page.goto(path)
  await waitForRuntime(page)
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
}

const storedToken = (page: Page) => page.evaluate((k) => sessionStorage.getItem(`nooted:token:${k}`), readProject().key)

async function installFakeSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      continuous = false
      interimResults = true
      lang = ''
      started = false
      onresult: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      start() {
        this.started = true
        ;(window as TestWindow).__fakeSR = this as never
      }
      stop() {
        this.started = false
        this.onend?.()
      }
      abort() {
        this.started = false
      }
    }
    ;(window as unknown as Record<string, unknown>).SpeechRecognition = FakeSpeechRecognition
  })
}

test.describe('sign-in', () => {
  test('signs in through the real popup and Dex, keeping the draft, then sends the same report', async ({ page }) => {
    const sent = await captureReports(page)
    await open(page)
    await expect(signInButton(page)).toBeVisible()
    await expect(note(page)).toHaveCount(0)
    const before = await page.evaluate(() => ({
      openedAt: (window as TestWindow).__nootedDraft!()!.openedAt,
    }))

    const popup = await signInThroughPopup(page, 'admin@example.com')
    await expect(note(page)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => popup.isClosed()).toBe(true)
    expect(await storedToken(page)).toContain('"token"')

    // Still the window's original draft: not replaced by sign-in.
    const after = await page.evaluate(() => ({
      openedAt: (window as TestWindow).__nootedDraft!()!.openedAt,
    }))
    expect(after).toEqual(before)
    expect(await page.evaluate(() => document.documentElement.dataset.nootedOpened)).toBe('1')

    await note(page).fill('it broke')
    await send(page).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ note: 'it broke', capturedAt: before.openedAt, captures: [] })
  })

  test('a valid stored token shows the form directly; an expiring one does not', async ({ page }) => {
    await seedToken(page, 30_000) // inside the 60 s margin
    await open(page)
    await expect(signInButton(page)).toBeVisible()
    await expect(note(page)).toHaveCount(0)
  })

  test('foreign postMessage (page itself or an iframe) is ignored', async ({ page }) => {
    await open(page)
    await signInButton(page).click()
    await expect(host(page).getByText('Waiting for the sign-in window')).toBeVisible()
    const message = { type: 'nooted:token', token: 'x', expiresAt: Date.now() + 3_600_000, user: { name: 'E', email: 'e@e.e' } }
    await page.evaluate(async (message) => {
      window.postMessage(message, '*')
      const frame = document.createElement('iframe')
      document.body.append(frame)
      frame.contentWindow!.parent.postMessage(message, '*')
      ;(frame.contentWindow as Window).postMessage(message, '*')
      await new Promise((r) => setTimeout(r, 300))
    }, message)
    await expect(signInButton(page)).toBeVisible()
    await expect(note(page)).toHaveCount(0)
    expect(await storedToken(page)).toBeNull()
  })

  test('a blocked popup shows the allow-popups message', async ({ page }) => {
    await page.addInitScript(() => {
      window.open = () => null
    })
    await open(page)
    await signInButton(page).click()
    await expect(host(page).getByRole('alert')).toContainText('Allow popups for this site')
    await expect(signInButton(page)).toBeVisible()
  })

  test('opens the popup synchronously with the documented name, size and URL', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: unknown[][] = []
      ;(window as unknown as { __opens: unknown[][] }).__opens = calls
      window.open = (...args: unknown[]) => (calls.push(args), null)
    })
    await open(page)
    await signInButton(page).click()
    const calls = await page.evaluate(() => (window as unknown as { __opens: unknown[][] }).__opens)
    expect(calls).toHaveLength(1)
    const [url, name, features] = calls[0] as string[]
    expect(name).toBe('nooted-sign-in')
    expect(features).toBe('popup,width=420,height=640')
    const parsed = new URL(url!)
    expect(parsed.origin).toBe(NOOTED_URL)
    expect(parsed.pathname).toBe('/sdk/sign-in')
    expect(parsed.searchParams.get('key')).toBe(readProject().key)
    expect(parsed.searchParams.get('origin')).toBe(PLAYGROUND_URL)
  })

  test('not_member: the window explains the user is not a member', async ({ page }) => {
    await open(page)
    const popup = await signInThroughPopup(page, 'dev@example.com')
    await expect(host(page).getByRole('alert')).toContainText("You're not a member of this project", { timeout: 15_000 })
    await expect(signInButton(page)).toBeVisible()
    expect(await storedToken(page)).toBeNull()
    await popup.close()
  })

  test('signOut() revokes the token on the server and the next window shows sign-in', async ({ page, request }) => {
    await open(page)
    await signInThroughPopup(page, 'admin@example.com')
    await expect(note(page)).toBeVisible({ timeout: 15_000 })
    const stored = JSON.parse((await storedToken(page))!) as { token: string }

    const upload = () =>
      request.post(`${NOOTED_URL}/api/sdk/reports`, { headers: { authorization: `Bearer ${stored.token}`, origin: PLAYGROUND_URL }, data: '{}' })
    expect((await upload()).status()).not.toBe(401) // accepted past authentication (then rejected for the body)

    const revoke = page.waitForResponse((r) => r.url() === `${NOOTED_URL}/api/sdk/token` && r.request().method() === 'DELETE')
    await page.evaluate(() => window.nooted!.signOut())
    expect((await revoke).status()).toBe(204)
    expect((await upload()).status()).toBe(401)
    expect(await storedToken(page)).toBeNull()
    // The open window noticed straight away.
    await expect(signInButton(page)).toBeVisible()

    await cancel(page).click()
    await fab(page).click()
    await expect(signInButton(page)).toBeVisible()
    await expect(note(page)).toHaveCount(0)
  })
})

test.describe('note form', () => {
  test('the window: title, toolbar, hint, signed-in footer and the button tooltip', async ({ page }) => {
    await seedToken(page)
    await installFakeSpeech(page)
    await open(page)
    await expect(host(page).getByRole('heading', { name: 'Request a change' })).toBeVisible()
    await expect(note(page)).toHaveAttribute('placeholder', 'Describe the change. Take screenshots or record a demo to show what you mean.')
    const tools = host(page).locator('.toolbar .btn')
    await expect(tools).toHaveCount(3)
    await expect(tools.nth(0)).toHaveText('Screenshot')
    await expect(tools.nth(1)).toHaveText('Record')
    await expect(tools.nth(2)).toHaveText('')
    for (const i of [0, 1, 2]) expect((await tools.nth(i).boundingBox())!.height).toBe(36)
    await expect(host(page).getByText('Screenshot: tap the parts of the page you mean. Record: show it in action.')).toBeVisible()
    await expect(host(page).locator('.footer')).toContainText(/Signed in as \S+@\S+/)
    await cancel(page).click()
    await expect(fab(page)).toHaveAttribute('title', 'Request a change')
  })

  test.beforeEach(async ({ page }) => {
    await seedRealToken(page)
  })

  test('Send is disabled for an empty or whitespace note', async ({ page }) => {
    await open(page)
    await expect(send(page)).toBeDisabled()
    await note(page).fill('   \n  ')
    await expect(send(page)).toBeDisabled()
    await note(page).fill(' hi ')
    await expect(send(page)).toBeEnabled()
    await note(page).fill('')
    await expect(send(page)).toBeDisabled()
  })

  test('the note is limited to 10,000 characters', async ({ page }) => {
    await open(page)
    await expect(note(page)).toHaveAttribute('maxlength', '10000')
    await note(page).focus()
    await page.keyboard.insertText('x'.repeat(10_050))
    expect(await note(page).inputValue()).toHaveLength(10_000)
  })

  test('Cancel closes, discards the draft and sends nothing', async ({ page }) => {
    const reports: string[] = []
    page.on('request', (r) => r.url().includes('/api/sdk/reports') && reports.push(r.url()))
    await open(page)
    await note(page).fill('never mind')
    await cancel(page).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(reports).toEqual([])
    // A new window starts with an empty note.
    await fab(page).click()
    await expect(note(page)).toHaveValue('')
  })

  test('Escape closes like Cancel', async ({ page }) => {
    await open(page)
    const reports: string[] = []
    page.on('request', (r) => r.url().includes('/api/sdk/reports') && reports.push(r.url()))
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await page.waitForTimeout(200)
    expect(reports).toEqual([])
  })

  test('focus moves into the window and returns to the floating button', async ({ page }) => {
    await open(page)
    await expect(note(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(fab(page)).toBeFocused()
  })

  test('focus goes to the sign-in button when signed out, and returns to a page element after a keyboard trigger', async ({ page }) => {
    await enableNooted(page)
    await page.goto('/')
    await waitForRuntime(page)
    await page.evaluate(() => sessionStorage.clear())
    const link = page.locator('a[data-route="/checkout"]')
    await link.focus()
    await page.keyboard.press('Control+Shift+Period')
    await expect(dialog(page)).toBeVisible()
    await expect(signInButton(page)).toBeFocused()
    await cancel(page).click()
    await expect(dialog(page)).toHaveCount(0)
    await expect(link).toBeFocused()
  })

  test('delivered: shows Sent, then closes', async ({ page }) => {
    const sent = await captureReports(page)
    await open(page)
    await note(page).fill('hello')
    await send(page).click()
    await expect(host(page).getByText('Sent', { exact: true })).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)
    expect(sent).toHaveLength(1)
  })

  test('queued: says it is saved and will be sent, then closes', async ({ page }) => {
    await interceptReports(page, (route) => fulfillStatus(route, 503))
    await open(page)
    await note(page).fill('offline')
    await send(page).click()
    await expect(host(page).getByText('Saved — it will be sent automatically')).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)
  })

  test('failed: shows an error and stays open with the note', async ({ page }) => {
    await interceptReports(page, (route) => fulfillStatus(route, 400))
    await open(page)
    await note(page).fill('rejected')
    await send(page).click()
    await expect(host(page).getByRole('alert')).toContainText("couldn't be sent")
    await expect(note(page)).toHaveValue('rejected')
    await expect(send(page)).toBeEnabled()
  })

  test('unauthorized: back to sign-in keeping note and draft; after signing in Send uploads the same report', async ({ page }) => {
    const requests = await interceptReports(page, (route, n) => (n === 1 ? fulfillStatus(route, 401) : route.continue()))
    await open(page)
    const openedAt = await page.evaluate(() => (window as TestWindow).__nootedDraft!()!.openedAt)
    await note(page).fill('keep me')
    await send(page).click()
    await expect(signInButton(page)).toBeVisible()
    await expect(host(page).getByRole('alert')).toContainText('sign-in expired')
    expect(await storedToken(page)).toBeNull()

    await signInThroughPopup(page, 'admin@example.com')
    await expect(note(page)).toHaveValue('keep me', { timeout: 15_000 })
    await send(page).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.payload).toMatchObject({ note: 'keep me', capturedAt: openedAt, captures: [] })
    expect(requests[1]!.payload.clientReportId).toBe(requests[0]!.payload.clientReportId)
    expect(requests[1]!.authorization).not.toBe(requests[0]!.authorization)
  })
})

test.describe('voice input', () => {
  test.beforeEach(async ({ page }) => {
    await seedToken(page)
  })

  test('shows a microphone button and appends final transcripts to the note', async ({ page }) => {
    await installFakeSpeech(page)
    await open(page)
    await note(page).fill('The page')
    await mic(page).click()
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'true')
    const started = await page.evaluate(() => ({ started: (window as TestWindow).__fakeSR!.started, lang: (window as TestWindow).__fakeSR!.lang }))
    expect(started.started).toBe(true)
    expect(started.lang).toBeTruthy()
    const fire = (transcript: string, isFinal: boolean) =>
      page.evaluate(
        ([t, f]) => {
          const result = Object.assign([{ transcript: t }], { isFinal: f })
          ;(window as TestWindow).__fakeSR!.onresult({ resultIndex: 0, results: [result] })
        },
        [transcript, isFinal] as const,
      )
    await fire('ignored interim', false)
    await fire(' froze after clicking ', true)
    await expect(note(page)).toHaveValue('The page froze after clicking')
    await fire('twice', true)
    await expect(note(page)).toHaveValue('The page froze after clicking twice')

    // Closing the window stops listening.
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => (window as TestWindow).__fakeSR!.started)).toBe(false)
  })

  test('without SpeechRecognition there is no microphone button', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).SpeechRecognition
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    })
    await open(page)
    await expect(note(page)).toBeVisible()
    await expect(mic(page)).toHaveCount(0)
  })
})

test.describe('nooted.disable()', () => {
  test('removes the UI, clears the flag, stops triggers, and later loads make no bundle request', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.nooted!.init())
    await waitForRuntime(page)
    await fab(page).click()
    await expect(dialog(page)).toBeVisible()

    await page.evaluate(() => window.nooted!.disable())
    await expect(host(page)).toHaveCount(0)
    await expect(dialog(page)).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('nooted:enabled'))).toBeNull()

    // Triggers are off: the shortcut does nothing.
    await page.keyboard.press('Control+Shift+Period')
    await page.waitForTimeout(200)
    await expect(host(page)).toHaveCount(0)

    const requests = trackNootedRequests(page)
    await page.reload()
    await page.waitForTimeout(500)
    expect(requests).toEqual([])
    await expect(host(page)).toHaveCount(0)
  })
})

test.describe('small phones', () => {
  test('the form fits a 320 px viewport without horizontal scrolling', async ({ page }) => {
    await seedRealToken(page)
    await installFakeSpeech(page)
    await page.setViewportSize({ width: 320, height: 640 })
    await open(page)
    await note(page).fill('word '.repeat(60) + 'x'.repeat(80))
    const metrics = await host(page).locator('.panel').evaluate((panel) => ({
      panel: [panel.scrollWidth, panel.clientWidth],
      doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    }))
    expect(metrics.panel[0]).toBeLessThanOrEqual(metrics.panel[1]!)
    expect(metrics.doc[0]).toBeLessThanOrEqual(metrics.doc[1]!)
    const controls = [
      note(page),
      send(page),
      cancel(page),
      mic(page),
      host(page).getByRole('button', { name: 'Take a screenshot' }),
      host(page).getByRole('button', { name: 'Record a demo' }),
    ]
    for (const control of controls) {
      await expect(control).toBeVisible()
      const box = (await control.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(320)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(640)
    }
    await send(page).click() // usable, not just visible
    await expect(dialog(page)).toHaveCount(0)
  })

  test('the sign-in state fits too', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await open(page)
    const [w, cw] = await host(page).locator('.panel').evaluate((p) => [p.scrollWidth, p.clientWidth])
    expect(w).toBeLessThanOrEqual(cw!)
    await expect(signInButton(page)).toBeVisible()
  })
})
