import { FloatingButton } from './FloatingButton.tsx'
import { ReportWindow } from './ReportWindow.tsx'
import { useAppState } from './state-hook.ts'

export function App({ shakeThreshold }: { shakeThreshold: () => number | undefined }) {
  const state = useAppState()
  return (
    <>
      {state.button && <FloatingButton pending={state.pending} shakeThreshold={shakeThreshold} />}
      {state.open && <ReportWindow />}
    </>
  )
}
