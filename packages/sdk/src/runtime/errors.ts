// Adds uncaught errors and unhandled rejections to the recording as `nooted:error` custom events.
import { record } from '@rrweb/record'
import type { EarlyError } from '../loader/types.ts'
import { guard } from './safe.ts'

const MAX_REASON = 1000
const SELF = '/sdk/v1/nooted.js'

export interface ErrorPayload {
  message: string
  stack?: string
  source?: string
  line?: number
  column?: number
  time: number
}

/** A rejection reason that is not an Error becomes a string, JSON when possible, capped. */
export function stringifyReason(reason: unknown): string {
  let text: string
  if (typeof reason === 'string') {
    text = reason
  } else {
    try {
      text = JSON.stringify(reason) ?? String(reason)
    } catch {
      text = String(reason)
    }
  }
  return text.slice(0, MAX_REASON)
}

function isErrorLike(value: unknown): value is { message: unknown; stack?: unknown } {
  return value instanceof Error || (typeof value === 'object' && value !== null && 'message' in value && 'stack' in value)
}

function fromReason(reason: unknown, time: number): ErrorPayload {
  if (isErrorLike(reason)) {
    const payload: ErrorPayload = { message: String(reason.message).slice(0, MAX_REASON), time }
    if (typeof reason.stack === 'string') payload.stack = reason.stack
    return payload
  }
  return { message: stringifyReason(reason), time }
}

/** Pure conversion of a loader-queued error, an ErrorEvent-shaped object or a rejection. */
export function toPayload(input: EarlyError): ErrorPayload {
  if (input.type === 'rejection') return fromReason(input.reason, input.time)
  const payload: ErrorPayload = { message: input.message, time: input.time }
  if (input.stack) payload.stack = input.stack
  if (input.source) payload.source = input.source
  if (input.line !== undefined) payload.line = input.line
  if (input.column !== undefined) payload.column = input.column
  return payload
}

/** Errors that come from this very script are not recorded. */
function isOwn(payload: ErrorPayload): boolean {
  return !!(payload.source?.endsWith(SELF) || payload.stack?.includes(SELF))
}

let recording = false
let pending: ErrorPayload[] = []
let adding = false

function add(payload: ErrorPayload): void {
  if (adding || isOwn(payload)) return
  if (!recording) {
    if (pending.length < 50) pending.push(payload)
    return
  }
  adding = true
  try {
    record.addCustomEvent('nooted:error', payload)
  } finally {
    adding = false
  }
}

/**
 * Starts listening. Errors seen before recording starts (and the loader's `early` ones)
 * are kept and added by the returned `ready()`, which the recorder calls once it runs.
 */
export function startErrors(early: EarlyError[]): { ready: () => void; stop: () => void } {
  pending = early.map(toPayload)

  const onError = guard((event: ErrorEvent) => {
    add(
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
  })
  const onRejection = guard((event: PromiseRejectionEvent) => {
    add(toPayload({ type: 'rejection', reason: event.reason, time: Date.now() }))
  })

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return {
    ready: guard(() => {
      recording = true
      const queued = pending
      pending = []
      for (const payload of queued) guard(add)(payload)
    }),
    stop: guard(() => {
      recording = false
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }) as () => void,
  }
}
