const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

export function relativeTime(iso: string | number): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export function absoluteTime(iso: string | number): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function pageLabel(url: string): string {
  try {
    const u = new URL(url)
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

/** Path (and query) of a URL, for places where the host is already known. */
export function pagePath(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function statusLabel(status: string): string {
  if (status === 'new') return 'New'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/** m:ss */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "Chrome 126 on Android" from a user agent; falls back to the raw string when nothing is recognised. */
export function summarizeUserAgent(ua: string): string {
  const major = (re: RegExp) => re.exec(ua)?.[1]?.split('.')[0]
  let browser: string | undefined
  const pick = (name: string, re: RegExp) => {
    const v = major(re)
    if (v !== undefined) browser = `${name} ${v}`
  }
  if (/Edg(?:e|A|iOS)?\//.test(ua)) pick('Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/)
  else if (/OPR\/|Opera/.test(ua)) pick('Opera', /OPR\/([\d.]+)/)
  else if (/SamsungBrowser\//.test(ua)) pick('Samsung Internet', /SamsungBrowser\/([\d.]+)/)
  else if (/Firefox\/|FxiOS\//.test(ua)) pick('Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/)
  else if (/Chrome\/|CriOS\//.test(ua)) pick('Chrome', /(?:Chrome|CriOS)\/([\d.]+)/)
  else if (/Safari\//.test(ua)) pick('Safari', /Version\/([\d.]+)/)

  let os: string | undefined
  if (/Windows/.test(ua)) os = 'Windows'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Linux|X11/.test(ua)) os = 'Linux'

  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? ua
}
