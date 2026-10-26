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
  events: z.array(RrwebEvent).min(1),
})

export type ReportPayload = z.infer<typeof ReportPayload>
