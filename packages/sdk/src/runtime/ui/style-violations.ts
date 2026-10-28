// CSP style-violation detection for the replay player (reused by the capture cards, group 4).
// A strict `style-src` blocks the inline <style> elements rrweb rebuilds in the replay iframe,
// which makes the preview look unstyled. Callers show a notice when this fires.

/** Only inline <style> elements and rules matter; style-src-attr (style="" attributes) doesn't affect the replay's sheets. */
export function isStyleViolation(event: Event): boolean {
  const directive = (event as SecurityPolicyViolationEvent).effectiveDirective ?? ''
  return directive === 'style-src' || directive === 'style-src-elem'
}

/**
 * Listens for `securitypolicyviolation` on `doc`. rrweb calls document.open() on the replay document
 * when it rebuilds a snapshot, which drops every listener on it, so the listener is re-added after
 * each open(). Returns a function that removes it.
 */
export function watchViolations(doc: Document, onViolation: (event: Event) => void): () => void {
  const open = doc.open
  doc.open = function (this: Document, ...args: unknown[]) {
    const result = (open as (...a: unknown[]) => unknown).apply(this, args)
    doc.addEventListener('securitypolicyviolation', onViolation)
    return result
  } as typeof doc.open
  doc.addEventListener('securitypolicyviolation', onViolation)
  return () => {
    doc.open = open
    doc.removeEventListener('securitypolicyviolation', onViolation)
  }
}
