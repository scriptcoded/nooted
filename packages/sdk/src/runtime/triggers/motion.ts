// Shake trigger: feeds devicemotion into the pure detector.
import { guard } from '../safe.ts'
import { trigger } from '../trigger.ts'
import { cachedMotionPermission } from './motion-permission.ts'
import { detectShake, initialShakeState } from './shake.ts'

let attached = false
let detach: (() => void) | undefined

/** Starts listening for shakes (idempotent). `threshold` is read per event so init() can change it later. */
export function attachMotion(threshold: () => number | undefined): void {
  if (attached) return
  attached = true
  let state = initialShakeState()
  const onMotion = guard((event: DeviceMotionEvent) => {
      // Denied on iOS means no events in practice; ignore any that still arrive.
      if (cachedMotionPermission() === 'denied') return
      const a = event.accelerationIncludingGravity
      if (!a || a.x == null || a.y == null || a.z == null) return
      const result = detectShake(
        { x: a.x, y: a.y, z: a.z, t: event.timeStamp || performance.now() },
        state,
        { threshold: threshold() },
      )
      state = result.state
      if (result.fired) trigger()
  })
  window.addEventListener('devicemotion', onMotion)
  detach = () => window.removeEventListener('devicemotion', onMotion)
}

/** Stops listening ("Turn off"). A later attachMotion() starts again. */
export function stopMotion(): void {
  detach?.()
  detach = undefined
  attached = false
}

/**
 * At boot: attach straight away unless access was denied this session. Where permission is needed
 * (iOS), no events arrive until the button's first tap grants it. Desktop Chromium also exposes
 * requestPermission, so gating the listener on it would disable shake where it needs no prompt.
 */
export function startMotion(threshold: () => number | undefined): void {
  if (cachedMotionPermission() !== 'denied') attachMotion(threshold)
}
