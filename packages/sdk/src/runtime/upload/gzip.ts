import { gzipSync, strToU8 } from 'fflate'

export interface GzipOptions {
  /** Skip CompressionStream and use fflate (also used when it's unavailable). */
  forceFallback?: boolean
}

/** Gzips a string with CompressionStream where available, else fflate. */
export async function gzip(text: string, options: GzipOptions = {}): Promise<Uint8Array> {
  if (!options.forceFallback && typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch {
      // fall through to fflate
    }
  }
  return gzipSync(strToU8(text))
}
