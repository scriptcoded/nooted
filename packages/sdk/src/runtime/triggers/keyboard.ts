// Ctrl+Shift+. (Cmd+Shift+. on macOS).
import { guard } from '../safe.ts'
import { trigger } from '../trigger.ts'

export function startKeyboard(): () => void {
  const onKey = guard((event: KeyboardEvent) => {
    if (event.code !== 'Period' || !event.shiftKey || !(event.ctrlKey || event.metaKey)) return
    if (trigger()) event.preventDefault()
  })
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
