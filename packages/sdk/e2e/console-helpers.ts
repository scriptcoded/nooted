import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { expect, type Page } from '@playwright/test'
import { bar, dialog, done, fab, host, mark, note, pointButton, recordButton, stopRecording } from './capture-helpers.ts'
import { ADMIN_EMAIL } from './env.ts'
import { enableNooted, debugNooted, readProject, seedRealToken, waitForRuntime } from './helpers.ts'

/**
 * Sends one real report through the SDK UI: "The [1] button should confirm, see [2] and [3]", with a screenshot
 * capture of #fx-counter, a recording that opens the menu, and a whole-page screenshot capture. Returns the item's id.
 */
export async function sendRealReport(page: Page): Promise<string> {
  await debugNooted(page)
  await enableNooted(page)
  await seedRealToken(page)
  await page.goto('/')
  await waitForRuntime(page)
  await expect(page.locator('#fx-counter')).toBeVisible()

  const reply = page.waitForResponse((r) => r.url().endsWith('/api/sdk/reports') && r.request().method() === 'POST')

  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  await note(page).click()
  await page.keyboard.type('The ')
  await pointButton(page).click()
  await expect(bar(page)).toBeVisible()
  await mark(page, '#fx-counter')
  await done(page)

  await note(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' button should confirm, see ')
  await recordButton(page).click()
  await expect(bar(page)).toContainText('Recording')
  await page.locator('#fx-menu-button').click()
  await expect(page.locator('#fx-menu')).toBeVisible()
  await page.waitForTimeout(600) // a clip needs some length to show a duration
  await stopRecording(page)

  await note(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' and ')
  await pointButton(page).click()
  await expect(bar(page)).toBeVisible()
  await done(page) // nothing marked: the whole page

  await expect(note(page)).toHaveValue(/^The \[1\]\s+button should confirm, see \[2\]\s+and \[3\]\s*$/)
  await host(page).getByRole('button', { name: 'Send', exact: true }).click()
  const response = await reply
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

/**
 * Inserts a report written before captures existed (no `captures`, no `clientReportId`) straight into the
 * server's database and blob directory, as an older server would have stored it. Returns the item's id.
 */
export function insertLegacyItem(): string {
  const { id: projectId, dataDir } = readProject()
  const id = randomUUID()
  const blobKey = `projects/${projectId}/reports/${id}.json.gz`
  const note = 'Old report: the footer link is broken'
  const url = 'http://localhost:4821/?legacy'
  const blob = {
    note,
    url,
    capturedAt: Date.now() - 86_400_000,
    device: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', viewport: { width: 1280, height: 720, devicePixelRatio: 1 } },
    events: [],
  }
  const file = join(dataDir, 'blobs', blobKey)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, gzipSync(JSON.stringify(blob)))

  const db = new DatabaseSync(join(dataDir, 'nooted.db'))
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL) as { id: string } | undefined
    if (!user) throw new Error('the admin user is missing')
    db.prepare(
      `INSERT INTO feedback_items (id, project_id, client_report_id, reporter_id, note, url, captured_at, status, release, blob_key, capture_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NULL, ?, 0, ?)`,
    ).run(id, projectId, randomUUID(), user.id, note, url, blob.capturedAt, blobKey, Date.now() - 86_400_000)
  } finally {
    db.close()
  }
  return id
}

