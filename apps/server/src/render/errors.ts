export type RenderErrorCode = 'unavailable' | 'timeout' | 'failed'

/** Thrown for any failure to draw an image, so callers can report it uniformly. */
export class RenderError extends Error {
  code: RenderErrorCode

  constructor(code: RenderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RenderError'
    this.code = code
  }
}
