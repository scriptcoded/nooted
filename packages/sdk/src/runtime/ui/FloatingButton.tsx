import { useEffect, useRef, useState } from 'preact/hooks'
import { attachMotion } from '../triggers/motion.ts'
import { requestMotionPermission } from '../triggers/motion-permission.ts'
import { trigger } from '../trigger.ts'

// Position is stored as fractions (0..1) of the free range (viewport minus button and margins), so it
// survives other viewport sizes and rotation, and "left edge" stays the left edge.
const KEY = 'nooted:button-pos'
const SIZE = 48
const MARGIN = 12
const DRAG_THRESHOLD = 6

interface Pos {
  fx: number
  fy: number
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function loadPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Pos> | null
    if (p && Number.isFinite(p.fx) && Number.isFinite(p.fy)) return { fx: clamp01(p.fx!), fy: clamp01(p.fy!) }
  } catch {
    // Fall through to the default.
  }
  return { fx: 1, fy: 1 } // bottom-right
}

function toPx(pos: Pos): { left: number; top: number } {
  const rangeX = Math.max(0, window.innerWidth - SIZE - 2 * MARGIN)
  const rangeY = Math.max(0, window.innerHeight - SIZE - 2 * MARGIN)
  return { left: MARGIN + pos.fx * rangeX, top: MARGIN + pos.fy * rangeY }
}

function fromPx(left: number, top: number): Pos {
  const rangeX = window.innerWidth - SIZE - 2 * MARGIN
  const rangeY = window.innerHeight - SIZE - 2 * MARGIN
  return { fx: rangeX > 0 ? clamp01((left - MARGIN) / rangeX) : 0, fy: rangeY > 0 ? clamp01((top - MARGIN) / rangeY) : 0 }
}

export function FloatingButton({ pending, shakeThreshold }: { pending: number; shakeThreshold: () => number | undefined }) {
  const [pos, setPos] = useState<Pos>(loadPos)
  const [dragging, setDragging] = useState(false)
  const [, resized] = useState(0)
  const drag = useRef<{ id: number; sx: number; sy: number; dx: number; dy: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const onResize = () => resized((n) => n + 1) // fractions are re-applied, so the clamp follows the viewport
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { left, top } = toPx(pos)

  return (
    <button
      type="button"
      class={dragging ? 'fab dragging' : 'fab'}
      aria-label="Report a problem"
      style={{ left: `${left}px`, top: `${top}px` }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false }
        suppressClick.current = false
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          // Capture is a nicety.
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return
        if (!d.moved) {
          d.moved = true
          setDragging(true)
        }
        setPos(fromPx(e.clientX - d.dx, e.clientY - d.dy))
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        drag.current = null
        if (d.moved) {
          suppressClick.current = true
          setDragging(false)
          const final = fromPx(e.clientX - d.dx, e.clientY - d.dy)
          setPos(final)
          try {
            localStorage.setItem(KEY, JSON.stringify(final))
          } catch {
            // Position just won't persist.
          }
        }
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        // Must run synchronously inside the click for iOS to show the prompt.
        requestMotionPermission(() => attachMotion(shakeThreshold))
        trigger()
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l9.5 17h-19z" />
        <path d="M12 10v4M12 17.5v.01" />
      </svg>
      {pending > 0 && <span class="badge" aria-hidden="true">{pending > 99 ? '99+' : pending}</span>}
    </button>
  )
}
