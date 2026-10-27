import type { ReportPayload } from '@nooted/shared'

// Same value as NOOTED_ERROR_TAG in @nooted/shared. Imported by value, that module would pull zod into the runtime bundle.
const NOOTED_ERROR_TAG = 'nooted:error'

export interface FrozenBuffer {
  events: readonly unknown[]
  /** Trigger time, ms since epoch. */
  capturedAt: number
  /** `location.href` at trigger time. */
  url: string
}

export type DeviceInfo = ReportPayload['device']

export interface BuildPayloadInput {
  clientReportId?: string
  note: string
  frozen: FrozenBuffer
  release?: string
  device?: DeviceInfo
  /** Range of the recording to point at; ignored when the recording is left out. */
  focus?: { start: number; end: number }
  /** Default true. When false only `nooted:error` events are sent, with `recording: false`. */
  includeRecording?: boolean
}

function isErrorEvent(event: unknown): boolean {
  const e = event as { type?: unknown; data?: { tag?: unknown } | null } | null
  return e?.type === 5 && e.data?.tag === NOOTED_ERROR_TAG
}

/** Reads device info from the browser globals. */
export function readDeviceInfo(): DeviceInfo {
  const w = globalThis as unknown as {
    navigator?: { userAgent?: string }
    innerWidth?: number
    innerHeight?: number
    devicePixelRatio?: number
  }
  return {
    userAgent: w.navigator?.userAgent || 'unknown',
    viewport: {
      width: Math.max(1, Math.round(w.innerWidth || 1)),
      height: Math.max(1, Math.round(w.innerHeight || 1)),
      devicePixelRatio: w.devicePixelRatio || 1,
    },
  }
}

/** The URL and capture time come from the freeze, never from the current page. */
export function buildPayload(input: BuildPayloadInput): ReportPayload {
  const { frozen } = input
  const includeRecording = input.includeRecording ?? true
  const events = includeRecording ? frozen.events : frozen.events.filter(isErrorEvent)
  const payload: ReportPayload = {
    clientReportId: input.clientReportId ?? crypto.randomUUID(),
    note: input.note,
    url: frozen.url,
    capturedAt: Math.round(frozen.capturedAt),
    device: input.device ?? readDeviceInfo(),
    events: events as ReportPayload['events'],
  }
  if (input.release) payload.release = input.release
  if (!includeRecording) payload.recording = false
  else if (input.focus) payload.focus = { start: input.focus.start, end: input.focus.end }
  return payload
}
