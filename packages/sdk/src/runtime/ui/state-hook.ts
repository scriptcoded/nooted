import { useEffect, useState } from 'preact/hooks'
import { getState, subscribe, type AppState } from '../state.ts'

export function useAppState(): AppState {
  const [state, set] = useState(getState())
  useEffect(() => {
    set(getState())
    return subscribe(set)
  }, [])
  return state
}
