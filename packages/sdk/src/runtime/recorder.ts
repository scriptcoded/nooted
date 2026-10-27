// Starts rrweb with the privacy rules from the design and feeds the buffer.
// Privacy markers (all optional, set by the host app): data-nooted="show" | "block" | "mask".
import { record } from '@rrweb/record'
import { buffer } from './buffer.ts'
import { guard } from './safe.ts'

const SHOW = '[data-nooted="show"]'

/** All inputs are masked, except inside `data-nooted="show"`. Password fields are always masked. */
export function maskInput(text: string, element?: HTMLElement | null): string {
  const type = element?.getAttribute?.('type')?.toLowerCase()
  const visible = type !== 'password' && !!element?.closest?.(SHOW)
  return visible ? text : '*'.repeat(text.length)
}

let stopRecording: (() => void) | undefined

/**
 * Starts recording as soon as `document.body` exists. `onStart` runs once rrweb is
 * recording (custom events can be added from then on). Returns a stop function.
 */
export function startRecorder(onStart?: () => void): () => void {
  let stopped = false

  const begin = guard(() => {
    if (stopped || stopRecording) return
    stopRecording =
      record({
        emit: (event, isCheckout) => buffer.push(event, isCheckout),
        checkoutEveryNms: 30_000,
        maskAllInputs: true,
        maskInputFn: maskInput,
        blockSelector: '[data-nooted="block"], #nooted-host',
        maskTextSelector: '[data-nooted="mask"]',
        inlineStylesheet: true,
        recordCanvas: false,
        collectFonts: false,
        sampling: { mousemove: 50, scroll: 150, input: 'last' },
      }) ?? undefined
    onStart?.()
  })

  if (document.body) begin()
  else document.addEventListener('DOMContentLoaded', begin, { once: true })

  return guard(() => {
    stopped = true
    document.removeEventListener('DOMContentLoaded', begin)
    stopRecording?.()
    stopRecording = undefined
  }) as () => void
}
