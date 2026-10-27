// Runtime entry (the IIFE served as /sdk/v1/nooted.js). It takes over the loader's
// `window.nooted` stub: real methods replace the queueing ones, queued calls are
// replayed in order, and early errors are kept for the error recorder.
import type { InitOptions } from '../index.ts'
import type { ApiMethod, EarlyError } from '../loader/types.ts'
import { signOut } from './auth/sign-in.ts'
import { buffer } from './buffer.ts'
import { startErrors } from './errors.ts'
import { setRelease } from './upload/config.ts'
import { startRetry, stopRetry } from './upload/retry.ts'
import { startRecorder } from './recorder.ts'
import { captureNonce } from './preview/load-replay.ts'
import { guard, log } from './safe.ts'
import { setState } from './state.ts'
import { installTestHooks } from './test-hook.ts'
import { close, trigger } from './trigger.ts'
import { startKeyboard } from './triggers/keyboard.ts'
import { startMotion, stopMotion } from './triggers/motion.ts'
import { mount, unmount } from './ui/mount.tsx'
import { setTurnOffHandler } from './ui/turn-off.ts'

// Before anything async: document.currentScript is only set while the script runs.
captureNonce()

const ENABLED_KEY = 'nooted:enabled'

/** Errors the loader caught before this runtime started. Replayed by the errors module (group 5). */
export let earlyErrors: EarlyError[] = []

/** InitOptions plus knobs that are deliberately undocumented. */
type RuntimeOptions = InitOptions & { shakeThreshold?: number }

let options: RuntimeOptions = {}

/** Stops recording (used by "Turn off"). */
export let stopRecording: (() => void) | undefined

/** Stops the keyboard shortcut, set at boot. */
let stopKeyboard: (() => void) | undefined
let stopErrors: (() => void) | undefined

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
    turnOff()
  },
}

setTurnOffHandler(() => void methods.disable())

/**
 * Stops everything this runtime started: recording, error capture, triggers, the UI (including its
 * re-attach observer) and the buffer. The flag is cleared by the caller. The runtime does not restart
 * until the next page load.
 */
export function turnOff(): void {
  close()
  stopRecording?.()
  stopRecording = undefined
  stopErrors?.()
  stopErrors = undefined
  stopKeyboard?.()
  stopKeyboard = undefined
  stopMotion()
  stopRetry()
  unmount()
  buffer.clear()
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
  earlyErrors = stub.e.splice(0)
  stub.t = true
  const errors = startErrors(earlyErrors)
  stopErrors = errors.stop
  stopRecording = startRecorder(errors.ready)
  for (const [name, args] of queued) {
    const method = stub[name] as (...a: unknown[]) => void
    method(...args)
  }
  // After the queue so `init({ button: false })` is known before the first render.
  installTestHooks()
  const threshold = () => options.shakeThreshold
  stopKeyboard = startKeyboard()
  startMotion(threshold)
  mount(threshold)
  startRetry()
}

try {
  boot()
} catch (error) {
  log.warn(error)
}
