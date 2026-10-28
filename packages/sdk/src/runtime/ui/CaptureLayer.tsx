// Capture mode UI inside the shadow root: the highlight boxes (Point) and the capture bar (Point and Record).
// The host stays 0x0 with pointer-events none; the bar opts in, the highlights never do.
import { useEffect, useReducer, useState } from 'preact/hooks'
import { cancelCapture, finishPoint, stopRecord } from '../capture/controller.ts'
import { getHover, getMarked, subscribeMarking } from '../capture/marking.ts'
import { RECORD_LIMIT_MS } from '../capture/session.ts'
import { useAppState } from './state-hook.ts'

const BADGE = 18

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

function Box({ element, kind }: { element: Element; kind: 'marked' | 'hover' }) {
  if (!element.isConnected) return null
  const r = element.getBoundingClientRect()
  // The check badge sits on the top-right corner and is kept inside the viewport.
  const badgeLeft = clamp(r.right - BADGE / 2, 0, window.innerWidth - BADGE) - r.left
  const badgeTop = clamp(r.top - BADGE / 2, 0, window.innerHeight - BADGE) - r.top
  return (
    <div
      class={`hl ${kind}`}
      data-nooted-highlight={kind}
      style={{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }}
    >
      {kind === 'marked' && (
        <span class="hl-badge" style={{ left: `${badgeLeft}px`, top: `${badgeTop}px` }}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
      )}
    </div>
  )
}

const clock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function RecordText({ since }: { since: number }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [])
  const elapsed = Date.now() - since
  const ending = RECORD_LIMIT_MS - elapsed <= 10_000
  return (
    <span class={ending ? 'cbar-title timer ending' : 'cbar-title timer'}>
      Recording <span class="clock">{clock(elapsed)}</span>
    </span>
  )
}

export function CaptureLayer() {
  const state = useAppState()
  const [, rerender] = useState(0)
  useEffect(() => subscribeMarking(() => rerender((n) => n + 1)), [])
  const mode = state.captureMode
  if (!mode) return null

  if (mode.kind === 'record') {
    return (
      <div class="cbar" role="region" aria-label="Capture">
        <span class="rec-dot" aria-hidden="true" />
        <span class="cbar-text" role="status">
          <RecordText since={mode.startedAt} />
          <span class="cbar-sub">Use the page</span>
        </span>
        <button type="button" class="cbtn ghost" onClick={cancelCapture}>Cancel</button>
        <button type="button" class="cbtn stop" onClick={stopRecord}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="1.5" />
          </svg>
          Stop
        </button>
      </div>
    )
  }

  const hover = getHover()
  const marked = getMarked()
  return (
    <>
      <div class="hl-layer" aria-hidden="true">
        {hover && !marked.includes(hover) && <Box element={hover} kind="hover" />}
        {marked.map((element) => (
          <Box key={element} element={element} kind="marked" />
        ))}
      </div>
      <div class="cbar" role="region" aria-label="Capture">
        <span class="cbar-text">
          <span class="cbar-title">Tap what you mean</span>
          {mode.selected > 0 && (
            <span class="cbar-sub" role="status">
              {mode.selected} selected
            </span>
          )}
        </span>
        <button type="button" class="cbtn ghost" onClick={cancelCapture}>Cancel</button>
        <button type="button" class="cbtn primary" onClick={finishPoint}>Done</button>
      </div>
    </>
  )
}
