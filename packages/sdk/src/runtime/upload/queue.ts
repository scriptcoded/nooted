// Persistent upload queue: IndexedDB (db `nooted`, store `queue`) with an in-memory fallback.
import { log } from '../safe.ts'

export interface QueueItem {
  clientReportId: string
  projectKey: string
  /** The gzipped report body, exactly as it will be uploaded. */
  bytes: Uint8Array
  createdAt: number
}

export const MAX_ITEMS = 20
export const MAX_AGE_MS = 7 * 24 * 3_600_000

const DB_NAME = 'nooted'
const STORE = 'queue'

const memory = new Map<string, QueueItem>()
let dbPromise: Promise<IDBDatabase | null> | undefined

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'clientReportId' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** Runs `fn` against the store; any failure switches to the memory fallback for the rest of the page's life. */
async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, fallback: () => T): Promise<T> {
  const db = await openDb()
  if (!db) return fallback()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    log.warn('the report queue is not available, keeping reports in memory', error)
    dbPromise = Promise.resolve(null)
    return fallback()
  }
}

async function all(): Promise<QueueItem[]> {
  const items = await withStore<QueueItem[]>('readonly', (s) => s.getAll() as IDBRequest<QueueItem[]>, () => [...memory.values()])
  return items.sort((a, b) => a.createdAt - b.createdAt)
}

export async function remove(clientReportId: string): Promise<void> {
  await withStore<unknown>('readwrite', (s) => s.delete(clientReportId) as IDBRequest<unknown>, () => void memory.delete(clientReportId))
}

/** Drops items older than 7 days. */
async function prune(items: QueueItem[], now: number): Promise<QueueItem[]> {
  const fresh: QueueItem[] = []
  for (const item of items) {
    if (now - item.createdAt > MAX_AGE_MS) await remove(item.clientReportId)
    else fresh.push(item)
  }
  return fresh
}

/** The queued reports for a project, oldest first, after dropping expired ones. */
export async function list(projectKey: string, now: number = Date.now()): Promise<QueueItem[]> {
  const fresh = await prune(await all(), now)
  return fresh.filter((item) => item.projectKey === projectKey)
}

export async function count(projectKey: string): Promise<number> {
  return (await list(projectKey)).length
}

/** Adds (or replaces) a report; drops the oldest ones, with a warning, when more than 20 are queued. */
export async function add(item: QueueItem): Promise<void> {
  await withStore<unknown>('readwrite', (s) => s.put(item) as IDBRequest<unknown>, () => void memory.set(item.clientReportId, item))
  const items = await prune(await all(), item.createdAt)
  for (const old of items.slice(0, Math.max(0, items.length - MAX_ITEMS))) {
    log.warn('the report queue is full; dropping the oldest queued report')
    await remove(old.clientReportId)
  }
}

/** Test seam: forget everything held in memory and reopen the database on next use. */
export function resetForTests(): void {
  memory.clear()
  dbPromise = undefined
}
