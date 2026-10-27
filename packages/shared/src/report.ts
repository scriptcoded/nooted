import { z } from 'zod'

export const REPORT_LIMITS = {
  maxCompressedBytes: 10 * 1024 * 1024,
  maxDecompressedBytes: 100 * 1024 * 1024,
  maxNoteLength: 10_000,
} as const

// Only the stable rrweb event envelope is validated; extra fields are kept.
const RrwebEvent = z.looseObject({
  type: z.number().int(),
  timestamp: z.number(),
  data: z.unknown(),
})

const HttpUrl = z.url().refine((value) => /^https?:\/\//i.test(value), {
  message: 'URL must use http or https',
})

/** rrweb custom event type (EventType.Custom). */
const CUSTOM_EVENT_TYPE = 5
/** Tag of the custom events the SDK records for uncaught errors. */
export const NOOTED_ERROR_TAG = 'nooted:error'
/** Slack after the last event, so a focus end may sit at the trigger time. */
const FOCUS_END_SLACK_MS = 1000

export const ReportPayload = z.strictObject({
  clientReportId: z.uuid(),
  note: z.string().trim().min(1).max(REPORT_LIMITS.maxNoteLength),
  url: HttpUrl,
  capturedAt: z.number().int().positive(),
  release: z.string().min(1).max(200).optional(),
  device: z.strictObject({
    userAgent: z.string().min(1).max(1000),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      devicePixelRatio: z.number().positive(),
    }),
  }),
  events: z.array(RrwebEvent),
  /** Sub-range of the recording the reporter wants looked at (ms since epoch). */
  focus: z.strictObject({ start: z.number(), end: z.number() }).optional(),
  /** `false` means the screen recording was left out; absent means included. */
  recording: z.literal(false).optional(),
}).superRefine((report, ctx) => {
  const { events, focus } = report
  if (report.recording === false) {
    events.forEach((event, index) => {
      const data = event.data as { tag?: unknown } | null | undefined
      if (event.type !== CUSTOM_EVENT_TYPE || data?.tag !== NOOTED_ERROR_TAG) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index],
          message: `Only ${NOOTED_ERROR_TAG} custom events are allowed when recording is false`,
        })
      }
    })
    if (focus !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['focus'], message: 'focus is not allowed when recording is false' })
    }
    return
  }
  if (events.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['events'], message: 'events must not be empty unless recording is false' })
  }
  if (focus === undefined) return
  if (!(focus.start < focus.end)) {
    ctx.addIssue({ code: 'custom', path: ['focus'], message: 'focus.start must be less than focus.end' })
  }
  if (events.length === 0) return
  let min = Infinity
  let max = -Infinity
  for (const event of events) {
    if (event.timestamp < min) min = event.timestamp
    if (event.timestamp > max) max = event.timestamp
  }
  const upper = max + FOCUS_END_SLACK_MS
  for (const key of ['start', 'end'] as const) {
    if (focus[key] < min || focus[key] > upper) {
      ctx.addIssue({
        code: 'custom',
        path: ['focus', key],
        message: `focus.${key} must be within the recorded events (${min} to ${upper})`,
      })
    }
  }
})

export type ReportPayload = z.infer<typeof ReportPayload>
