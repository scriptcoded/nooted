// The floating button unmounts while the report window is open, so the window can't hand focus back to
// it directly. The button sets this when it opens the window and takes focus again when it re-appears.
let restore = false

export const requestFabFocus = (): void => {
  restore = true
}
export const clearFabFocus = (): void => {
  restore = false
}
/** True once, if the button should take focus now. */
export const takeFabFocus = (): boolean => {
  const value = restore
  restore = false
  return value
}
