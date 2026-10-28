// Runtime entry (the IIFE served as /sdk/v1/nooted.js). It takes over the loader's
// `window.nooted` stub: real methods replace the queueing ones, queued calls are
// replayed in order.
import type { InitOptions } from '../index.ts'
import type { ApiMethod } from '../loader/types.ts'
import { signOut } from './auth/sign-in.ts'
import { setRelease } from './upload/config.ts'
import { startRetry, stopRetry } from './upload/retry.ts'
import { captureNonce } from './preview/load-replay.ts'
import { guard, log } from './safe.ts'
import { setState } from './state.ts'
import { installTestHooks } from './test-hook.ts'
import { close, trigger } from './trigger.ts'
import { startKeyboard } from './triggers/keyboard.ts'
import { startMotion, stopMotion } from './triggers/motion.ts'
import { mount, unmount } from './ui/mount.tsx'

// Before anything async: document.currentScript is only set while the script runs.
captureNonce()

const ENABLED_KEY = 'nooted:enabled'

/** InitOptions plus knobs that are deliberately undocumented. */
type RuntimeOptions = InitOptions & { shakeThreshold?: number }

let options: RuntimeOptions = {}

/** Stops the keyboard shortcut while running. */
let stopKeyboard: (() => void) | undefined
/** Triggers, UI and retries are active. */
let running = false
/** While the loader's queue is replayed, start() waits until it is drained. */
let draining = false
/** The runtime only loads on an enabled device; init() and disable() change this afterwards. */
let enabled = true

function setEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1')
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Nothing to do.
  }
}

const methods: Record<ApiMethod, (arg?: unknown) => void | Promise<void>> = {
  init(arg) {
    options = { ...options, ...((arg as RuntimeOptions | undefined) ?? {}) }
    setRelease(options.release)
    if (typeof options.button === 'boolean') setState({ button: options.button })
    // init() means "on for this device"; the loader has already set the flag, this keeps it set.
    setEnabled(true)
    enabled = true
    // After disable() on this page, init() brings everything back without a reload.
    if (!draining) start()
  },
  open() {
    trigger()
  },
  async signOut() {
    setState({ token: null })
    await signOut()
  },
  disable() {
    setEnabled(false)
    enabled = false
    turnOff()
  },
}

const threshold = () => options.shakeThreshold

/** Starts the triggers, the UI and the retry loop. Idempotent. */
function start(): void {
  if (running) return
  running = true
  stopKeyboard = startKeyboard()
  startMotion(threshold)
  mount(threshold)
  startRetry()
}

/**
 * Stops everything start() started: triggers, the UI (including its re-attach observer) and the retry
 * timer. The flag is cleared by the caller. A later init() starts it all again.
 */
export function turnOff(): void {
  running = false
  close()
  stopKeyboard?.()
  stopKeyboard = undefined
  stopMotion()
  stopRetry()
  unmount()
}

function boot(): void {
  const stub = window.nooted
  if (!stub || stub.t) return

  for (const name of Object.keys(methods) as ApiMethod[]) {
    const real = guard((...args: unknown[]) => methods[name](args[0]))
    ;(stub as unknown as Record<ApiMethod, (...a: unknown[]) => void>)[name] = (...args) => void real(...args)
  }

  // Drain in order. Take the arrays first so a call made while draining is not replayed twice.
  const queued = stub.q.splice(0)
  stub.t = true
  draining = true
  try {
    for (const [name, args] of queued) {
      const method = stub[name] as (...a: unknown[]) => void
      method(...args)
    }
  } finally {
    draining = false
  }
  installTestHooks()
  // After the queue, so `init({ button: false })` is known before the first render, and a queued
  // disable() leaves everything off.
  if (enabled) start()
}

try {
  boot()
} catch (error) {
  log.warn(error)
}
