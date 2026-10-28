// One capture session: rrweb records from Point or Record starting until Done, Stop or Cancel.
// Nothing is recorded outside a session, and the events go into the session's own array.
import { record } from '@rrweb/record'
import type { Capture } from '@nooted/shared'
import { log } from '../safe.ts'
import { describeElement } from './describe.ts'
import { toPayload } from './errors.ts'
import { isUsable, resolveMarks, selectEvents } from './events.ts'
import { recordOptions } from './record-options.ts'

export const RECORD_LIMIT_MS = 60_000
/** The SDK's own scripts: errors from them are not the page's. */
const OWN_SCRIPTS = ['/sdk/v1/nooted.js', '/sdk/v1/replay.js']

export type CaptureKind = 'point' | 'record'

interface RecordedEvent {
  type: number
  timestamp: number
  data?: unknown
}

/** A capture without its number: the caller assigns `n`. */
export type NewCapture = Omit<Capture, 'n'>

export interface FinishResult {
  /** null when nothing usable was recorded. */
  capture: NewCapture | null
  /** Marks left out because their element left the page (or isn't in the snapshot). */
  dropped: number
}

export interface Session {
  /** Takes the closing snapshot, builds the capture and stops recording. `marked` is empty for a recording. */
  finish(marked: readonly Element[]): FinishResult
  /** Stops recording and discards everything. */
  cancel(): void
}

const isOwn = (...texts: (string | undefined)[]): boolean =>
  texts.some((text) => !!text && OWN_SCRIPTS.some((script) => text.includes(script)))

/**
 * A recording also listens for page errors, and `onLimit` runs when the 60 s limit is reached (the
 * caller then finishes the capture). Returns null if rrweb can't start.
 */
export function startSession(kind: CaptureKind, onLimit: () => void): Session | null {
  const demo = kind === 'record'
  const events: RecordedEvent[] = []
  let stopRecord: (() => void) | undefined
  let stopErrors: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    stopRecord = record({ ...recordOptions(), emit: (event) => void events.push(event as RecordedEvent) }) ?? undefined
  } catch (error) {
    log.warn(error)
  }
  if (!stopRecord) return null

  const stopAll = (): void => {
    clearTimeout(timer)
    timer = undefined
    stopErrors?.()
    stopErrors = undefined
    stopRecord?.()
    stopRecord = undefined
  }

  const addError = (payload: ReturnType<typeof toPayload>): void => {
    if (isOwn(payload.source, payload.stack)) return
    try {
      record.addCustomEvent('nooted:error', payload)
    } catch (error) {
      log.warn(error)
    }
  }

  if (demo) {
    const onError = (event: ErrorEvent) =>
      addError(
        toPayload({
          type: 'error',
          message: event.message,
          source: event.filename || undefined,
          line: event.lineno || undefined,
          column: event.colno || undefined,
          stack: event.error instanceof Error ? event.error.stack : undefined,
          time: Date.now(),
        }),
      )
    const onRejection = (event: PromiseRejectionEvent) => addError(toPayload({ type: 'rejection', reason: event.reason, time: Date.now() }))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    stopErrors = () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
    timer = setTimeout(() => {
      try {
        onLimit()
      } catch (error) {
        log.warn(error)
      }
    }, RECORD_LIMIT_MS)
  }

  return {
    finish(marked) {
      try {
        clearTimeout(timer)
        stopErrors?.()
        stopErrors = undefined
        record.takeFullSnapshot()
        const kept = selectEvents(events, demo)
        const { marks, dropped } = demo
          ? { marks: [], dropped: 0 }
          : resolveMarks(marked, {
              isConnected: (element) => element.isConnected,
              getId: (element) => record.mirror.getId(element),
              describe: describeElement,
            })
        if (!isUsable(kept)) return { capture: null, dropped }
        return {
          capture: {
            url: location.href,
            capturedAt: Date.now(),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            scroll: { x: Math.max(0, window.scrollX), y: Math.max(0, window.scrollY) },
            demo,
            events: kept as Capture['events'],
            marks,
          },
          dropped,
        }
      } catch (error) {
        log.warn(error)
        return { capture: null, dropped: marked.length }
      } finally {
        stopAll()
        events.length = 0
      }
    },

    cancel() {
      stopAll()
      events.length = 0
    },
  }
}
