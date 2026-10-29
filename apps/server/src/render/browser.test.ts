import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Browser, LaunchOptions } from 'playwright-core'
import { createBrowserManager } from './browser.ts'
import { RenderError } from './errors.ts'
import { skipUnlessChromium } from './test-support.ts'

function fakeBrowser(): Browser {
  return { on() {}, close: async () => {} } as unknown as Browser
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('browser manager', () => {
  it('never launches when images are off', async () => {
    let launches = 0
    const manager = createBrowserManager({ mode: 'off', launch: async () => (launches++, fakeBrowser()) })
    assert.equal(manager.isAvailable(), false)
    await assert.rejects(manager.withBrowser(async () => 1), (e: unknown) => e instanceof RenderError && e.code === 'unavailable')
    assert.equal(launches, 0)
  })

  it('launches with Playwright signal handling off so the server shutdown owns it', async () => {
    let options: LaunchOptions | undefined
    const manager = createBrowserManager({
      mode: 'auto',
      launch: async (launchOptions) => ((options = launchOptions), fakeBrowser()),
    })
    await manager.withBrowser(async () => 1)
    assert.equal(options?.handleSIGINT, false)
    assert.equal(options?.handleSIGTERM, false)
    assert.equal(options?.handleSIGHUP, false)
    await manager.close()
  })

  it('reports unavailable for a bad CHROMIUM_PATH, logs once, and retries after the cool-down', async () => {
    const lines: string[] = []
    let clock = 1000
    const manager = createBrowserManager({
      mode: 'auto',
      chromiumPath: '/nonexistent/chromium',
      unavailableMs: 600_000,
      now: () => clock,
      log: (line) => lines.push(line),
    })
    const attempt = () => manager.withBrowser(async () => 1)
    await assert.rejects(attempt(), (e: unknown) => e instanceof RenderError && e.code === 'unavailable')
    assert.equal(manager.isAvailable(), false)
    assert.equal(lines.length, 1)
    assert.match(lines[0]!, /playwright-core install chromium-headless-shell/)
    assert.match(lines[0]!, /CHROMIUM_PATH/)
    await assert.rejects(attempt(), RenderError)
    assert.equal(lines.length, 1)
    clock += 600_001
    assert.equal(manager.isAvailable(), true)
    await assert.rejects(attempt(), RenderError)
    assert.equal(lines.length, 1, 'the same failure is not logged again')
  })

  it('allows two renders at once and queues the rest', async () => {
    let running = 0
    let peak = 0
    const manager = createBrowserManager({ mode: 'auto', launch: async () => fakeBrowser() })
    await Promise.all(
      Array.from({ length: 5 }, () =>
        manager.withBrowser(async () => {
          running++
          peak = Math.max(peak, running)
          await tick(20)
          running--
        }),
      ),
    )
    assert.equal(peak, 2)
  })

  it('shares one browser and closes it when idle, then relaunches', async () => {
    let launches = 0
    let closes = 0
    const browser = { on() {}, close: async () => void closes++ } as unknown as Browser
    const manager = createBrowserManager({ mode: 'auto', idleMs: 30, launch: async () => (launches++, browser) })
    await Promise.all([manager.withBrowser(async () => tick(5)), manager.withBrowser(async () => tick(5))])
    await manager.withBrowser(async () => {})
    assert.equal(launches, 1)
    await tick(100)
    assert.equal(closes, 1)
    await manager.withBrowser(async () => {})
    assert.equal(launches, 2)
    await manager.close()
  })

  it('launches the real headless shell', async (t) => {
    if (await skipUnlessChromium(t)) return
    const manager = createBrowserManager({ mode: 'auto' })
    try {
      const version = await manager.withBrowser(async (browser) => browser.version())
      assert.match(version, /^\d+\./)
    } finally {
      await manager.close()
    }
  })
})
