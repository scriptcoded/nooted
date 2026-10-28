// The rrweb record() options (privacy rules) for a capture session. Nothing records in the
// background any more: the capture session (group 3) calls `record({ emit, ...recordOptions() })`.
// Privacy markers (all optional, set by the host app): data-nooted="show" | "block" | "mask".
import type { record } from '@rrweb/record'

type RecordOptions = NonNullable<Parameters<typeof record>[0]>

const SHOW = '[data-nooted="show"]'

/** All inputs are masked, except inside `data-nooted="show"`. Password fields are always masked. */
export function maskInput(text: string, element?: HTMLElement | null): string {
  const type = element?.getAttribute?.('type')?.toLowerCase()
  const visible = type !== 'password' && !!element?.closest?.(SHOW)
  return visible ? text : '*'.repeat(text.length)
}

/** Everything `record()` needs except `emit`. */
export function recordOptions(): Omit<RecordOptions, 'emit'> {
  return {
    maskAllInputs: true,
    maskInputFn: maskInput,
    blockSelector: '[data-nooted="block"], #nooted-host',
    maskTextSelector: '[data-nooted="mask"]',
    inlineStylesheet: true,
    recordCanvas: false,
    collectFonts: false,
    sampling: { mousemove: 50, scroll: 150, input: 'last' },
  }
}
