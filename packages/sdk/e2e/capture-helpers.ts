import { expect, type Page } from '@playwright/test'
import type { Capture } from '@nooted/shared'
import { debugNooted, enableNooted, seedToken, waitForRuntime } from './helpers.ts'

export const host = (page: Page) => page.locator('#nooted-host')
export const fab = (page: Page) => host(page).getByRole('button', { name: 'Request a change' })
export const dialog = (page: Page) => page.getByRole('dialog', { name: 'Request a change' })
export const pointButton = (page: Page) => host(page).getByRole('button', { name: 'Point at something' })
export const recordButton = (page: Page) => host(page).getByRole('button', { name: 'Record a demo' })
export const note = (page: Page) => host(page).getByRole('textbox', { name: 'What should change?' })
export const bar = (page: Page) => host(page).getByRole('region', { name: 'Capture' })
export const barButton = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
export const marked = (page: Page) => host(page).locator('[data-nooted-highlight="marked"]')
export const hovered = (page: Page) => host(page).locator('[data-nooted-highlight="hover"]')

/** Opens the playground with Nooted enabled, the shadow root open and a (fake) token. Does not open the window. */
export async function setup(page: Page, path = '/'): Promise<void> {
  await debugNooted(page)
  await enableNooted(page)
  await seedToken(page)
  await page.goto(path)
  await waitForRuntime(page)
  // The playground's module un-hides the routed sections.
  await expect(page.locator('#fx-counter')).toBeVisible()
}

/** Opens the report window and starts Point. */
export async function beginPoint(page: Page): Promise<void> {
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  await pointButton(page).click()
  await expect(bar(page)).toBeVisible()
}

/** Opens the report window and starts Record. */
export async function beginRecord(page: Page): Promise<void> {
  await fab(page).click()
  await expect(dialog(page)).toBeVisible()
  await recordButton(page).click()
  await expect(bar(page)).toContainText('Recording')
}

/** Stops the recording and waits for the window to come back. */
export async function stopRecording(page: Page): Promise<void> {
  await barButton(page, 'Stop').click()
  await expect(bar(page)).toHaveCount(0)
}

/** Marks elements by clicking them (the page is intercepting clicks). */
export async function mark(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click()
}

export async function done(page: Page): Promise<void> {
  await barButton(page, 'Done').click()
  await expect(bar(page)).toHaveCount(0)
}

export async function draftCaptures(page: Page): Promise<Capture[]> {
  return page.evaluate(() => (window as unknown as { __nootedDraft: () => { captures: Capture[] } }).__nootedDraft().captures)
}

// rrweb serialized nodes: type 0 document, 2 element, 3 text.
export interface SNode {
  type: number
  id: number
  tagName?: string
  attributes?: Record<string, string | number | boolean>
  textContent?: string
  childNodes?: SNode[]
}

/** Every node in the capture's last full snapshot that matches. */
export function snapshotNodes(events: Capture['events'], match: (node: SNode) => boolean): SNode[] {
  const full = [...events].reverse().find((e) => e.type === 2)
  const out: SNode[] = []
  const walk = (node: SNode) => {
    if (match(node)) out.push(node)
    node.childNodes?.forEach(walk)
  }
  walk((full!.data as { node: SNode }).node)
  return out
}

/** Opens the window (if not open), types `text` at the end of the note, adds a Point capture marking `selector` and presses Done. */
export async function captureAfter(page: Page, text: string, selector: string): Promise<void> {
  if (!(await dialog(page).isVisible())) {
    await fab(page).click()
    await expect(dialog(page)).toBeVisible()
  }
  await note(page).click()
  await page.keyboard.press('Control+End')
  if (text) await page.keyboard.type(text)
  await pointButton(page).click()
  await expect(bar(page)).toBeVisible()
  await mark(page, selector)
  await done(page)
  await expect(note(page)).toBeFocused()
}
