import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { request as pwRequest, type Page, type Route } from '@playwright/test'
import type { ReportPayload } from '@nooted/shared'
import { NOOTED_URL, PLAYGROUND_URL, PROJECT_FILE, STORAGE_STATE } from './env.ts'

/** The project global setup created: its id and public key. */
export function readProject(): { id: string; key: string } {
  return JSON.parse(readFileSync(PROJECT_FILE, 'utf8'))
}

/** Enables Nooted before any page script runs, as if the device had been enabled earlier. */
export async function enableNooted(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nooted:enabled', '1')
    } catch {
      // about:blank and similar have no storage.
    }
  })
}

/** Requests to the Nooted origin made by the page, as they happen. */
export function trackNootedRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith(NOOTED_URL)) urls.push(request.url())
  })
  return urls
}

/**
 * Collects console messages that start with `[nooted]`, in order. Browser-generated
 * messages (such as CSP violations) don't, so they are not counted.
 */
export function collectNootedLogs(page: Page): { type: string; text: string }[] {
  const logs: { type: string; text: string }[] = []
  page.on('console', (message) => {
    if (message.text().startsWith('[nooted]')) logs.push({ type: message.type(), text: message.text() })
  })
  return logs
}

/**
 * Records every report upload (decoded from its gzipped JSON body) and lets the request
 * continue to the server. The raw data is never exposed by the API, so this is how tests
 * inspect what was sent.
 */
export async function captureReports(page: Page): Promise<ReportPayload[]> {
  const reports: ReportPayload[] = []
  await page.route('**/api/sdk/reports', async (route) => {
    const body = route.request().postDataBuffer()
    if (body) reports.push(JSON.parse(gunzipSync(body).toString('utf8')) as ReportPayload)
    await route.continue()
  })
  return reports
}

/** Resolves once the runtime has taken over the loader's global. */
export async function waitForRuntime(page: Page): Promise<void> {
  await page.waitForFunction(() => window.nooted?.t === true)
}

/** Opens Nooted's shadow root (so locators can pierce it) and turns on the test hooks. */
export async function debugNooted(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nooted:debug', '1')
      localStorage.setItem('nooted:test', '1')
    } catch {
      // No storage on about:blank.
    }
  })
}

/** Stores a (fake, not server-valid) upload token for the project in sessionStorage before any page script runs. */
export async function seedToken(page: Page, expiresInMs = 3_600_000): Promise<void> {
  const key = readProject().key
  await page.addInitScript(
    ({ key, expiresInMs }) => {
      try {
        if (!sessionStorage.getItem(`nooted:token:${key}`)) {
          sessionStorage.setItem(
            `nooted:token:${key}`,
            JSON.stringify({ token: 'seeded-token', expiresAt: Date.now() + expiresInMs, user: { name: 'Seeded', email: 'seeded@example.com' } }),
          )
        }
      } catch {
        // No storage on about:blank.
      }
    },
    { key, expiresInMs },
  )
}

/**
 * Clicks "Sign in to Nooted" and drives the popup: through Dex's login form when it asks (a Nooted
 * session in the browser context skips it), until the popup closes or settles on a page that
 * stays open (an error page). Returns the popup.
 */
export async function signInThroughPopup(page: Page, email: string, password = 'password'): Promise<Page> {
  const popupPromise = page.waitForEvent('popup')
  await page.locator('#nooted-host').getByRole('button', { name: 'Sign in to Nooted' }).click()
  const popup = await popupPromise
  const login = popup.locator('input[name="login"]')
  const deadline = Date.now() + 15_000
  while (!popup.isClosed() && Date.now() < deadline) {
    if (await login.isVisible().catch(() => false)) {
      await login.fill(email)
      await popup.locator('input[name="password"]').fill(password)
      await popup.locator('button[type="submit"]').click()
      break
    }
    if (new URL(popup.url()).pathname === '/sdk/sign-in' && (await popup.locator('h1').count().catch(() => 0)) > 0) {
      const title = await popup.locator('h1').textContent().catch(() => '')
      if (title !== 'Signing you in') break // an error page: it stays open
    }
    await page.waitForTimeout(100)
  }
  return popup
}

/** Asks the server for a real upload token, as the sign-in popup would (using the admin session from global setup). */
export async function mintToken(): Promise<{ token: string; expiresAt: number; user: { name: string; email: string } }> {
  const api = await pwRequest.newContext({ storageState: STORAGE_STATE })
  try {
    const response = await api.post(`${NOOTED_URL}/sdk/sign-in/token`, {
      headers: { 'x-nooted-sign-in': '1' },
      data: { key: readProject().key, origin: PLAYGROUND_URL },
    })
    if (!response.ok()) throw new Error(`could not mint a token: HTTP ${response.status()}`)
    return await response.json()
  } finally {
    await api.dispose()
  }
}

/** Like seedToken, but the token is real, so uploads are accepted by the server. */
export async function seedRealToken(page: Page): Promise<void> {
  const stored = await mintToken()
  const key = readProject().key
  await page.addInitScript(
    ({ key, stored }) => {
      try {
        if (!sessionStorage.getItem(`nooted:token:${key}`)) sessionStorage.setItem(`nooted:token:${key}`, JSON.stringify(stored))
      } catch {
        // No storage on about:blank.
      }
    },
    { key, stored },
  )
}

export interface FeedbackItem {
  id: string
  note: string
  url: string
  capturedAt: number
}

/** The project's items as the console API lists them (admin session). */
export async function listItems(): Promise<FeedbackItem[]> {
  const api = await pwRequest.newContext({ storageState: STORAGE_STATE })
  try {
    const response = await api.get(`${NOOTED_URL}/api/projects/${readProject().id}/feedback`)
    return ((await response.json()) as { items: FeedbackItem[] }).items
  } finally {
    await api.dispose()
  }
}

/** CORS headers for answers the test fabricates (the page is cross-origin to the server). */
export const CORS_HEADERS = { 'access-control-allow-origin': PLAYGROUND_URL, vary: 'Origin' }

export interface ReportRequest {
  payload: ReportPayload
  authorization: string | undefined
}

/**
 * Routes report uploads through `respond`, which gets the (1-based) request number and the route and must
 * fulfill, continue or abort it. Every POST is recorded. Preflights go to the real server.
 */
export async function interceptReports(
  page: Page,
  respond: (route: Route, n: number) => Promise<void> | void,
): Promise<ReportRequest[]> {
  const requests: ReportRequest[] = []
  await page.route('**/api/sdk/reports', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    const body = request.postDataBuffer()
    requests.push({
      payload: JSON.parse(gunzipSync(body!).toString('utf8')) as ReportPayload,
      authorization: request.headers()['authorization'],
    })
    await respond(route, requests.length)
  })
  return requests
}

export const fulfillStatus = (route: Route, status: number) =>
  route.fulfill({ status, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ error: 'test' }) })
