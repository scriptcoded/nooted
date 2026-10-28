// Pure conversion of errors to the `nooted:error` custom event payload. Group 3 attaches the listeners,
// only during a demo.

const MAX_REASON = 1000

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

/** An ErrorEvent-shaped error or a rejection. `time` is Date.now(). */
export type ErrorInput =
  | { type: 'error'; message: string; source?: string; line?: number; column?: number; stack?: string; time: number }
  | { type: 'rejection'; reason: unknown; time: number }

/** Pure conversion of an ErrorEvent-shaped object or a rejection. */
export function toPayload(input: ErrorInput): ErrorPayload {
  if (input.type === 'rejection') return fromReason(input.reason, input.time)
  const payload: ErrorPayload = { message: input.message, time: input.time }
  if (input.stack) payload.stack = input.stack
  if (input.source) payload.source = input.source
  if (input.line !== undefined) payload.line = input.line
  if (input.column !== undefined) payload.column = input.column
  return payload
}
