// The `[n]` capture tokens in the note: inserting one at the caret, removing every one of a capture.
// Pure string functions (unit tested); the controller wires them to the state.

export const MAX_CAPTURES = 10

/** Characters a token can sit directly in front of without a space ("... [1]." not "... [1] ."). */
const CLOSING = /[.,;:!?)\]}]/

export interface Caret {
  start: number
  end: number
}

/**
 * Puts `[n]` at `caret.end` (the selection is kept, not replaced). A space goes before when the previous
 * character isn't whitespace, and after unless the next one is whitespace or closing punctuation. The
 * returned caret sits after the token and that trailing space, so typing continues the sentence.
 */
export function insertToken(note: string, caret: Caret, n: number, max = Infinity): { note: string; caret: Caret } {
  const at = Math.max(0, Math.min(caret.end, note.length))
  const before = note.slice(0, at)
  const after = note.slice(at)
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : ''
  const next = after[0]
  const trail = next === undefined || (!/\s/.test(next) && !CLOSING.test(next)) ? ' ' : ''
  const token = `${lead}[${n}]${trail}`
  // Over the length limit: make room by cutting the text after the caret, never the token.
  const room = Math.max(0, max - before.length - token.length)
  const tail = after.slice(0, room)
  const position = before.length + token.length + (trail === '' && next === ' ' && tail.length > 0 ? 1 : 0)
  return { note: before + token + tail, caret: { start: position, end: position } }
}

/** Removes every `[n]` and tidies the whitespace around it. */
export function stripToken(note: string, n: number): string {
  const pattern = new RegExp(`([ \\t]*)\\[${n}\\]([ \\t]*)`, 'g')
  const result = note.replace(pattern, (match: string, lead: string, trail: string, offset: number, whole: string) => {
    const end = offset + match.length
    if (offset === 0 && lead === '') return '' // at the very start: drop the space after it too
    if (end === whole.length) return '' // at the very end: nothing to separate
    if (whole[end] === '\n' || (offset > 0 && whole[offset - 1] === '\n')) return '' // line edges keep their line
    if (trail === '' && (CLOSING.test(whole[end] ?? '') || lead === '')) return lead === '' || trail === '' ? '' : ' '
    return lead !== '' || trail !== '' ? ' ' : ''
  })
  return result
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

/**
 * The number for a new capture: one above the highest ever issued in this report (so numbers aren't
 * reused while it fits 1..MAX_CAPTURES), else the smallest free one. A reused number can't collide with a
 * leftover token, because removing a capture strips its tokens.
 */
export function nextNumber(existing: readonly number[], lastIssued: number): number {
  const candidate = Math.max(lastIssued, ...existing) + 1
  if (candidate <= MAX_CAPTURES) return candidate
  for (let i = 1; i <= MAX_CAPTURES; i++) if (!existing.includes(i)) return i
  return MAX_CAPTURES
}
