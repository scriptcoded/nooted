import type { Capture, ReportPayload } from '@nooted/shared'

export type DeviceInfo = ReportPayload['device']

export interface BuildPayloadInput {
  clientReportId?: string
  note: string
  /** When the report window opened, ms since epoch. */
  openedAt: number
  /** `location.href` when the window opened. */
  url: string
  /** Built by the capture code; taken as they are. */
  captures: readonly Capture[]
  release?: string
  device?: DeviceInfo
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

/** The URL and time are those of the window opening, never of the current page. */
export function buildPayload(input: BuildPayloadInput): ReportPayload {
  const payload: ReportPayload = {
    clientReportId: input.clientReportId ?? crypto.randomUUID(),
    note: input.note,
    url: input.url,
    capturedAt: Math.round(input.openedAt),
    device: input.device ?? readDeviceInfo(),
    captures: [...input.captures],
  }
  if (input.release) payload.release = input.release
  return payload
}
