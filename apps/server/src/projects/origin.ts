// Returns the normalized origin, or null if the value is not a plain http(s) origin.
export function normalizeOrigin(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.pathname !== '/' || url.search || url.hash) return null
  // new URL('https://a.com?') and 'https://a.com#' leave search/hash empty; reject by raw text.
  if (/[?#]/.test(value)) return null
  return url.origin
}
