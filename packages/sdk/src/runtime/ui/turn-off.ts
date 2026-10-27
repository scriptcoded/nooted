// "Turn off Nooted on this device". main.ts registers the real teardown (it owns the stop functions);
// this indirection keeps the UI from importing main.ts, which would be circular.
let handler: (() => void) | undefined

export function setTurnOffHandler(fn: () => void): void {
  handler = fn
}

export function turnOffNooted(): void {
  handler?.()
}
