import type { JSX } from 'preact'
import { useMemo, useRef, useState } from 'preact/hooks'
import { setState } from '../state.ts'
import type { FrozenReport } from '../state.ts'
import { errorMarkers, formatOffset, fromFraction, moveHandle, stepHandle, timelineSpan, toFocus, toFraction } from './timeline.ts'
import type { Handle, Range } from './timeline.ts'

export interface TimelineProps {
  frozen: FrozenReport
  /** The focus kept in state (restores the handles when the timeline is shown again). */
  focus?: { start: number; end: number }
  /** Called with the absolute time a handle was moved to (preview seeking, wired up by the preview). */
  onSeek?: (t: number) => void
}

const LABEL: Record<Handle, string> = { start: 'Focus start', end: 'Focus end' }

export function Timeline({ frozen, focus, onSeek }: TimelineProps) {
  const span = useMemo(() => timelineSpan(frozen), [frozen])
  const markers = useMemo(() => errorMarkers(frozen.events, span), [frozen, span])
  // The component keeps its own range so a handle snapped to "no focus" still shows where it is.
  const [range, setRange] = useState<Range>(() => focus ?? span)
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef<Handle | null>(null)

  const update = (next: Range, which: Handle) => {
    setRange(next)
    setState({ focus: toFocus(next, span) })
    onSeek?.(next[which])
  }

  const pointerTime = (event: PointerEvent): number => {
    const box = track.current!.getBoundingClientRect()
    return fromFraction(span, box.width > 0 ? (event.clientX - box.left) / box.width : 0)
  }

  const onPointerDown = (which: Handle) => (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    dragging.current = which
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    ;(event.currentTarget as HTMLElement).focus()
    event.preventDefault()
  }
  const onPointerMove = (which: Handle) => (event: PointerEvent) => {
    if (dragging.current !== which) return
    update(moveHandle(range, span, which, pointerTime(event)), which)
  }
  const onPointerUp = (which: Handle) => (event: PointerEvent) => {
    if (dragging.current !== which) return
    dragging.current = null
    try {
      ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    } catch {
      // Already released.
    }
  }

  const onKeyDown = (which: Handle) => (event: KeyboardEvent) => {
    let next: Range | undefined
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = stepHandle(range, span, which, 1, event.shiftKey)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next = stepHandle(range, span, which, -1, event.shiftKey)
        break
      case 'Home':
        next = moveHandle(range, span, which, span.start)
        break
      case 'End':
        next = moveHandle(range, span, which, span.end)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
    update(next, which)
  }

  const pct = (t: number) => `${(toFraction(span, t) * 100).toFixed(3)}%`
  const seconds = (t: number) => Math.round(Math.max(0, t - span.start) / 100) / 10
  const total = Math.round((span.end - span.start) / 100) / 10

  const handle = (which: Handle): JSX.Element => (
    <div
      class={`tl-handle ${which}`}
      role="slider"
      tabIndex={0}
      aria-label={LABEL[which]}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={seconds(range[which])}
      aria-valuetext={formatOffset(span, range[which])}
      style={{ left: pct(range[which]) }}
      onPointerDown={onPointerDown(which)}
      onPointerMove={onPointerMove(which)}
      onPointerUp={onPointerUp(which)}
      onPointerCancel={onPointerUp(which)}
      onKeyDown={onKeyDown(which)}
    />
  )

  return (
    <div class="timeline">
      <div class="tl-track" ref={track}>
        <div class="tl-rail" />
        <div class="tl-band" style={{ left: pct(range.start), width: `${((toFraction(span, range.end) - toFraction(span, range.start)) * 100).toFixed(3)}%` }} />
        {markers.map((t) => (
          <div class="tl-marker" data-time={t} title={`Error at ${formatOffset(span, t)}`} style={{ left: pct(t) }} />
        ))}
        {handle('start')}
        {handle('end')}
      </div>
      <div class="tl-times" aria-hidden="true">
        <span>{formatOffset(span, range.start)}</span>
        <span>{formatOffset(span, range.end)}</span>
      </div>
    </div>
  )
}
