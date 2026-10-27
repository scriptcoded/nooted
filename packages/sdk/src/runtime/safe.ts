// Nothing the runtime does may throw into the host page. guard() wraps a function so
// exceptions (sync, or from a returned promise) are logged and swallowed.

const PREFIX = '[nooted]'

export const log = {
  warn: (...args: unknown[]): void => console.warn(PREFIX, ...args),
  error: (...args: unknown[]): void => console.error(PREFIX, ...args),
}

export function guard<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined {
  return (...args: A): R | undefined => {
    try {
      const result = fn(...args)
      if (result instanceof Promise) {
        // Attach the handler to the same promise the caller gets, so a rejection is never unhandled.
        result.catch((error: unknown) => log.warn(error))
      }
      return result
    } catch (error) {
      log.warn(error)
      return undefined
    }
  }
}
