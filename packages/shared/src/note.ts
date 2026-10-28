// The `[n]` capture tokens in a report note. Pure string functions, shared by the SDK (which writes the
// tokens) and the console (which renders them as chips).

export type NotePart = { text: string } | { ref: number }

/**
 * Splits a note into text and `[n]` references, in order. Adjacent text is merged and empty text is
 * omitted. Brackets that don't hold a number ("[a]", "[ 1 ]") stay text.
 */
export function splitNote(note: string): NotePart[] {
  const parts: NotePart[] = []
  let text = ''
  let last = 0
  for (const match of note.matchAll(/\[(\d+)\]/g)) {
    const at = match.index
    text += note.slice(last, at)
    last = at + match[0].length
    if (text !== '') parts.push({ text })
    text = ''
    parts.push({ ref: Number(match[1]) })
  }
  text += note.slice(last)
  if (text !== '') parts.push({ text })
  return parts
}

/**
 * Tokens in the note that no capture has, such as a hand-typed "[2]", in order of first appearance.
 * The server rejects such reports for good, so the window must not send them.
 */
export function unknownTokens(note: string, existing: readonly number[]): number[] {
  const unknown: number[] = []
  for (const match of note.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1])
    if (!existing.includes(n) && !unknown.includes(n)) unknown.push(n)
  }
  return unknown
}
