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
