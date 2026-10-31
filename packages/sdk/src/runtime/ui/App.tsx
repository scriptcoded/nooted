import { useEffect } from 'preact/hooks'
import { clearFabFocus } from './focus-return.ts'
import { CaptureLayer } from './CaptureLayer.tsx'
import { FloatingButton } from './FloatingButton.tsx'
import { ReportWindow } from './ReportWindow.tsx'
import { useAppState } from './state-hook.ts'

export function App({ shakeThreshold }: { shakeThreshold: () => number | undefined }) {
  const state = useAppState()
  const capturing = !!state.captureMode
  // The button takes focus back when the window closes; if it isn't shown there is nothing to hand it to.
  useEffect(() => {
    if (!state.open) clearFabFocus()
  }, [state.open])
  return (
    <>
      {!capturing && (state.open ? state.minimized : state.button) && (
        <FloatingButton pending={state.pending} shakeThreshold={shakeThreshold} minimized={state.open && state.minimized} />
      )}
      {state.open && !state.minimized && !capturing && <ReportWindow />}
      {capturing && <CaptureLayer />}
    </>
  )
}
