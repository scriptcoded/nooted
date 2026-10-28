import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { REPORT_LIMITS, ReportPayload } from '@nooted/shared'
import type { BlobStore } from '../blobs.ts'

const gunzipAsync = promisify(gunzip)

export type LegacyDevice = {
  userAgent: string
  viewport: { width: number; height: number; devicePixelRatio: number }
}

export type LoadedReport =
  | { kind: 'v2'; payload: ReportPayload }
  | { kind: 'legacy'; note?: string; url?: string; capturedAt?: number; device?: LegacyDevice }

export const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function legacyDevice(v: unknown): LegacyDevice | undefined {
  if (!isObject(v) || typeof v.userAgent !== 'string' || !isObject(v.viewport)) return undefined
  const { width, height, devicePixelRatio } = v.viewport
  if (!isNum(width) || !isNum(height) || !isNum(devicePixelRatio)) return undefined
  return { userAgent: v.userAgent, viewport: { width, height, devicePixelRatio } }
}

function toLegacy(json: Record<string, unknown>): LoadedReport {
  const out: LoadedReport = { kind: 'legacy' }
  if (typeof json.note === 'string') out.note = json.note
  if (typeof json.url === 'string') out.url = json.url
  if (isNum(json.capturedAt)) out.capturedAt = json.capturedAt
  const device = legacyDevice(json.device)
  if (device) out.device = device
  return out
}

type Loaded = { report: LoadedReport; bytes: number }

// Throws when the blob is missing or unreadable (data loss), so callers can answer 500.
async function readReport(deps: { blobs: BlobStore }, item: { blobKey: string }): Promise<Loaded> {
  const compressed = await deps.blobs.get(item.blobKey)
  if (!compressed) throw new Error(`Report blob missing: ${item.blobKey}`)
  const raw = await gunzipAsync(compressed, { maxOutputLength: REPORT_LIMITS.maxDecompressedBytes })
  const json: unknown = JSON.parse(raw.toString('utf8'))
  const parsed = ReportPayload.safeParse(json)
  if (parsed.success) return { report: { kind: 'v2', payload: parsed.data }, bytes: raw.length }
  if (isObject(json)) return { report: toLegacy(json), bytes: raw.length }
  throw new Error(`Report blob is not a JSON object: ${item.blobKey}`)
}

export function loadReport(deps: { blobs: BlobStore }, item: { blobKey: string }): Promise<LoadedReport> {
  return readReport(deps, item).then((r) => r.report)
}

// Reports are immutable, so entries never need invalidating. The bound counts decompressed bytes.
export function createReportStore(deps: { blobs: BlobStore }, options: { maxCacheBytes?: number } = {}) {
  const max = options.maxCacheBytes ?? DEFAULT_CACHE_BYTES
  const cache = new Map<string, Loaded>()
  let total = 0

  return {
    async loadReport(item: { id: string; blobKey: string }): Promise<LoadedReport> {
      const hit = cache.get(item.id)
      if (hit) {
        cache.delete(item.id)
        cache.set(item.id, hit)
        return hit.report
      }
      const loaded = await readReport(deps, item)
      if (loaded.bytes <= max && !cache.has(item.id)) {
        cache.set(item.id, loaded)
        total += loaded.bytes
        for (const [key, entry] of cache) {
          if (total <= max) break
          cache.delete(key)
          total -= entry.bytes
        }
      }
      return loaded.report
    },
    stats: () => ({ entries: cache.size, bytes: total }),
  }
}

export type ReportStore = ReturnType<typeof createReportStore>
