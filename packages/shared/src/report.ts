import { z } from 'zod'

export const REPORT_LIMITS = {
  maxCompressedBytes: 10 * 1024 * 1024,
  maxDecompressedBytes: 100 * 1024 * 1024,
  maxNoteLength: 10_000,
  maxCaptures: 10,
  maxMarks: 20,
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

/** rrweb event type of a full snapshot (EventType.FullSnapshot). */
const FULL_SNAPSHOT_EVENT_TYPE = 2
/** Tag of the custom events the SDK records for uncaught errors during demos. */
export const NOOTED_ERROR_TAG = 'nooted:error'

const Finite = z.number().finite()
const PositiveInt = z.number().int().positive()

export const Mark = z.strictObject({
  nodeId: z.number().int(),
  tag: z.string().min(1).max(64),
  role: z.string().max(64).optional(),
  name: z.string().max(200).optional(),
  text: z.string().max(200),
  selector: z.string().min(1).max(500),
  rect: z.strictObject({ x: Finite, y: Finite, width: Finite, height: Finite }),
})

export const Capture = z.strictObject({
  n: z.number().int().min(1).max(REPORT_LIMITS.maxCaptures),
  url: HttpUrl,
  capturedAt: PositiveInt,
  viewport: z.strictObject({ width: PositiveInt, height: PositiveInt }),
  scroll: z.strictObject({ x: Finite.min(0), y: Finite.min(0) }),
  demo: z.boolean(),
  events: z.array(RrwebEvent).min(2),
  marks: z.array(Mark).max(REPORT_LIMITS.maxMarks),
})

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
  captures: z.array(Capture).max(REPORT_LIMITS.maxCaptures),
}).superRefine((report, ctx) => {
  const numbers = new Set<number>()
  report.captures.forEach((capture, index) => {
    if (numbers.has(capture.n)) {
      ctx.addIssue({ code: 'custom', path: ['captures', index, 'n'], message: `Duplicate capture number ${capture.n}` })
    }
    numbers.add(capture.n)
    if (!capture.events.some((event) => event.type === FULL_SNAPSHOT_EVENT_TYPE)) {
      ctx.addIssue({ code: 'custom', path: ['captures', index, 'events'], message: 'A capture needs a full snapshot event' })
    }
  })
  for (const match of report.note.matchAll(/\[(\d+)\]/g)) {
    if (!numbers.has(Number(match[1]))) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: `The note refers to ${match[0]}, but there is no such capture` })
    }
  }
})

export type Mark = z.infer<typeof Mark>
export type Capture = z.infer<typeof Capture>
export type ReportPayload = z.infer<typeof ReportPayload>
