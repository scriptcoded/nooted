import { chromium } from 'playwright-core'
import type { Browser, LaunchOptions } from 'playwright-core'
import { RenderError } from './errors.ts'

export const INSTALL_HINT = 'pnpm --filter @nooted/server exec playwright-core install chromium-headless-shell'

export type BrowserManagerOptions = {
  mode: 'auto' | 'off'
  /**
   * Explicit browser binary. Without it playwright-core launches the headless
   * shell it resolves itself (PLAYWRIGHT_BROWSERS_PATH or ~/.cache/ms-playwright),
   * and the launch fails if that is not installed.
   */
  chromiumPath?: string
  /** Close the browser after this long without renders. Default 5 minutes. */
  idleMs?: number
  /** After a failed launch, report unavailable for this long. Default 10 minutes. */
  unavailableMs?: number
  /** Maximum concurrent renders. Default 2. */
  maxConcurrent?: number
  /** Test hooks. */
  now?: () => number
  launch?: (options: LaunchOptions) => Promise<Browser>
  log?: (line: string) => void
}

export type BrowserManager = {
  /** Runs `fn` with the shared browser, holding one of the render slots. */
  withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T>
  /** True unless rendering is off or a recent launch failed. */
  isAvailable(): boolean
  /** Closes the browser now; it relaunches on the next use. */
  close(): Promise<void>
}

export function createBrowserManager(options: BrowserManagerOptions): BrowserManager {
  const idleMs = options.idleMs ?? 5 * 60_000
  const unavailableMs = options.unavailableMs ?? 10 * 60_000
  const maxConcurrent = options.maxConcurrent ?? 2
  const now = options.now ?? Date.now
  const launch = options.launch ?? ((launchOptions) => chromium.launch(launchOptions))
  const log = options.log ?? ((line) => console.warn(line))

  let browser: Browser | undefined
  let launching: Promise<Browser> | undefined
  let unavailableUntil = 0
  let loggedUnavailable = false
  let active = 0
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const waiting: Array<() => void> = []

  const isAvailable = () => options.mode !== 'off' && now() >= unavailableUntil

  async function getBrowser(): Promise<Browser> {
    if (options.mode === 'off') throw new RenderError('unavailable', 'Capture images are turned off (CAPTURE_IMAGES=off).')
    if (browser) return browser
    if (!isAvailable()) throw new RenderError('unavailable', 'Capture images are unavailable: the browser failed to launch recently.')
    launching ??= (async () => {
      try {
        const launched = await launch({
          headless: true,
          // The server's shutdown owns signals; Playwright's SIGINT handler would process.exit(130) mid-drain.
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
          ...(options.chromiumPath ? { executablePath: options.chromiumPath } : {}),
        })
        launched.on('disconnected', () => {
          if (browser === launched) browser = undefined
        })
        browser = launched
        loggedUnavailable = false
        return launched
      } catch (error) {
        unavailableUntil = now() + unavailableMs
        if (!loggedUnavailable) {
          loggedUnavailable = true
          const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
          log(
            `Capture images are unavailable: could not launch Chromium (${reason}). ` +
              `Install a browser with \`${INSTALL_HINT}\` or set CHROMIUM_PATH, or set CAPTURE_IMAGES=off.`,
          )
        }
        throw new RenderError('unavailable', 'Capture images are unavailable: the browser could not be launched.', { cause: error })
      } finally {
        launching = undefined
      }
    })()
    return launching
  }

  async function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active++
      return
    }
    // The slot is handed over directly, so `active` stays unchanged.
    await new Promise<void>((resolve) => waiting.push(resolve))
  }

  function release(): void {
    const next = waiting.shift()
    if (next) {
      next()
      return
    }
    active--
    if (active === 0) {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => void close(), idleMs)
      idleTimer.unref()
    }
  }

  async function close(): Promise<void> {
    clearTimeout(idleTimer)
    const current = browser
    browser = undefined
    await current?.close().catch(() => {})
  }

  return {
    isAvailable,
    close,
    async withBrowser(fn) {
      if (options.mode === 'off') throw new RenderError('unavailable', 'Capture images are turned off (CAPTURE_IMAGES=off).')
      await acquire()
      clearTimeout(idleTimer)
      try {
        return await fn(await getBrowser())
      } finally {
        release()
      }
    },
  }
}
