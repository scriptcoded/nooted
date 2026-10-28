// Single-line text helpers shared by the digest and the timeline captions.

export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A code span that survives backticks in the content. */
export function codeSpan(text: string): string {
  const clean = singleLine(text)
  if (!clean.includes('`')) return `\`${clean}\``
  return `\`\` ${clean} \`\``
}

export function quote(text: string): string {
  return `"${singleLine(text).replace(/"/g, '\\"')}"`
}
