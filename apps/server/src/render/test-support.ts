import type { TestContext } from 'node:test'
import { createBrowserManager } from './browser.ts'

let probe: Promise<boolean> | undefined

/** True (after skipping the test with a message) when no Chromium can be launched here. */
export async function skipUnlessChromium(t: TestContext): Promise<boolean> {
  probe ??= (async () => {
    const manager = createBrowserManager({ mode: 'auto', chromiumPath: process.env.CHROMIUM_PATH, log: () => {} })
    try {
      await manager.withBrowser(async () => {})
      return true
    } catch {
      return false
    } finally {
      await manager.close()
    }
  })()
  if (await probe) return false
  t.skip('Chromium is not installed (pnpm --filter @nooted/server exec playwright-core install chromium-headless-shell)')
  return true
}
