// Adds a stylesheet to a shadow root: a constructed stylesheet when possible (not subject to a host
// CSP's style-src), a <style> element otherwise.
const done = new WeakMap<ShadowRoot, Set<string>>()

export function adoptCss(shadow: ShadowRoot, css: string, key: string, replace = false): void {
  let keys = done.get(shadow)
  if (!keys) done.set(shadow, (keys = new Set()))
  if (keys.has(key)) return
  keys.add(key)
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    shadow.adoptedStyleSheets = replace ? [sheet] : [...shadow.adoptedStyleSheets, sheet]
  } catch {
    const style = document.createElement('style')
    style.textContent = css
    shadow.prepend(style)
  }
}
