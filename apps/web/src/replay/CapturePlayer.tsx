// A capture's replay as a paused final frame. The replayer renders at the capture's viewport size; a Layout
// (scale + offset) places it in the box, and the same layout places the mark boxes (rect minus scroll, since the
// replay shows the viewport at capture.scroll).
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Box, Skeleton } from '@mui/material'
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import { coverTopLayout, frameLayout, type Layout } from '@nooted/shared/frame'
import { checkpointTimes, seekSteps } from '@nooted/shared/seek'
import { formatClock } from '../format.ts'
import { loadReplayer } from './load.ts'
import type { Replayer } from '@rrweb/replay'

export interface PlayerCapture {
  n: number
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  demo: boolean
  durationMs: number
  marks: { rect: { x: number; y: number; width: number; height: number } }[]
}

export interface PlayerHandle {
  toggle(): void
}

interface CapturePlayerProps {
  capture: PlayerCapture
  /** Undefined while loading. */
  events: unknown[] | undefined
  failed?: boolean
  /** The large view: fitted to its container's width, play controls via `ref`. */
  large?: boolean
  /** Large view of a point capture with marks: framed around them (true) or the whole page (false). */
  zoomed?: boolean
  onPlayingChange?: (playing: boolean) => void
  ref?: Ref<PlayerHandle>
}

/** Pauses on the recording's last frame. A plain pause there shows earlier changes stale when a checkpoint is crossed (see seekSteps). */
function seekToEnd(replayer: Replayer, events: unknown[]) {
  const duration = replayer.getMetaData().totalTime
  for (const step of seekSteps(checkpointTimes(events), duration, duration)) replayer.pause(step)
}

// Padding around the selection in thumbnails (bigger than the SDK's, as these tiles are bigger) and in the large view.
const THUMB_PADDING = 32
const ZOOM_PADDING = 160

type Placed = Layout & { w: number }

export function CapturePlayer({ capture, events, failed, large, zoomed = true, onPlayingChange, ref }: CapturePlayerProps) {
  const frame = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<Replayer | null>(null)
  const playingRef = useRef(false)
  const placeRef = useRef<(() => void) | null>(null)
  const zoomedRef = useRef(zoomed)
  zoomedRef.current = zoomed
  const notify = useRef(onPlayingChange)
  notify.current = onPlayingChange
  const [layout, setLayout] = useState<Placed | null>(null)
  const [playing, setPlaying] = useState(false)
  const [broken, setBroken] = useState(false)

  const setPlay = (value: boolean) => {
    playingRef.current = value
    setPlaying(value)
    notify.current?.(value)
  }

  useImperativeHandle(ref, () => ({
    toggle() {
      const r = player.current
      if (!r) return
      if (playingRef.current) {
        r.pause()
        setPlay(false)
        return
      }
      const t = r.getCurrentTime()
      r.play(t >= r.getMetaData().totalTime - 100 ? 0 : t)
      setPlay(true)
    },
  }))

  useEffect(() => {
    const root = host.current
    const frameEl = frame.current
    if (!root || !frameEl || !events) return
    let cancelled = false
    let replayer: Replayer | undefined
    let observer: ResizeObserver | undefined
    const { width, height } = capture.viewport
    const rects = capture.marks.map((m) => ({
      x: m.rect.x - capture.scroll.x,
      y: m.rect.y - capture.scroll.y,
      width: m.rect.width,
      height: m.rect.height,
    }))
    const framed = rects.length > 0 && !capture.demo

    const place = () => {
      const wrapper = replayer?.wrapper
      const boxW = frameEl.clientWidth
      if (!wrapper || boxW <= 0) return
      let next: Layout
      if (large) {
        // Leave room for the title and the controls: the picture is at most ~70 vh.
        const maxHeight = Math.max(200, Math.min(window.innerHeight * 0.7, window.innerHeight - 220))
        if (framed && zoomedRef.current) {
          const boxH = Math.min(maxHeight, Math.round(boxW * 0.6))
          next = frameLayout(rects, width, height, boxW, boxH, ZOOM_PADDING)
          frameEl.style.height = `${boxH}px`
        } else {
          const scale = Math.min(1, boxW / width, maxHeight / height)
          next = { scale, tx: (boxW - width * scale) / 2, ty: 0 }
          frameEl.style.height = `${Math.ceil(height * scale)}px`
        }
      } else {
        const boxH = frameEl.clientHeight
        next = framed ? frameLayout(rects, width, height, boxW, boxH, THUMB_PADDING) : coverTopLayout(width, height, boxW, boxH)
      }
      wrapper.style.width = `${width}px`
      wrapper.style.height = `${height}px`
      wrapper.style.transform = `translate(${next.tx}px, ${next.ty}px) scale(${next.scale})`
      setLayout((p) => (p && p.scale === next.scale && p.tx === next.tx && p.ty === next.ty && p.w === boxW ? p : { ...next, w: boxW }))
    }

    void (async () => {
      try {
        const Replayer = await loadReplayer()
        if (cancelled) return
        replayer = new Replayer(events as ConstructorParameters<typeof Replayer>[0], {
          root,
          mouseTail: false,
          UNSAFE_replayCanvas: false,
          triggerFocus: false,
        })
        player.current = replayer
        const wrapper = replayer.wrapper
        wrapper.style.position = 'absolute'
        wrapper.style.top = '0'
        wrapper.style.left = '0'
        wrapper.style.transformOrigin = '0 0'
        // An iframe is transparent, so a page without its own background would show the console's
        // (dark) background. Browsers paint such pages on a white canvas; do the same.
        replayer.iframe.style.background = '#fff'
        replayer.iframe.style.colorScheme = 'light'
        replayer.on('finish', () => {
          if (!playingRef.current) return
          // Back to the final frame, ready to play again.
          if (replayer) seekToEnd(replayer, events)
          setPlay(false)
        })
        placeRef.current = place
        place()
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(place)
          observer.observe(frameEl)
        }
        // The last frame is what the capture is.
        seekToEnd(replayer, events)
      } catch (error) {
        console.warn('capture player failed', error)
        try {
          replayer?.destroy()
        } catch {
          // Already broken.
        }
        replayer = undefined
        player.current = null
        if (!cancelled) setBroken(true)
      }
    })()

    return () => {
      cancelled = true
      placeRef.current = null
      observer?.disconnect()
      player.current = null
      playingRef.current = false
      try {
        replayer?.destroy()
      } catch {
        // Nothing to do.
      }
      root.replaceChildren()
      setLayout(null)
      setPlaying(false)
    }
    // The capture object comes from a query and is stable per item.
  }, [capture, events, large])

  useEffect(() => placeRef.current?.(), [zoomed])

  const hasError = failed || broken
  const showMarks = layout && !playing && capture.marks.length > 0 && !capture.demo
  const loading = !hasError && (!events || !layout)

  return (
    <Box
      ref={frame}
      data-testid={large ? 'capture-large' : 'capture-thumb'}
      data-ready={!hasError && layout ? 'true' : 'false'}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        bgcolor: 'action.hover',
        width: '100%',
        ...(large ? { minHeight: 200, borderRadius: 1 } : { aspectRatio: '3 / 2' }),
      }}
    >
      <Box ref={host} sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', visibility: layout ? 'visible' : 'hidden' }} />
      {hasError && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'text.disabled' }} data-testid="capture-placeholder">
          <BrokenImageOutlinedIcon fontSize={large ? 'large' : 'medium'} />
        </Box>
      )}
      {loading && <Skeleton variant="rectangular" animation="wave" sx={{ position: 'absolute', inset: 0, height: '100%' }} />}
      {layout && showMarks && (
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {capture.marks.map((m, i) => (
            <Box
              key={i}
              data-testid="capture-mark"
              sx={{
                position: 'absolute',
                left: layout.tx + (m.rect.x - capture.scroll.x) * layout.scale,
                top: layout.ty + (m.rect.y - capture.scroll.y) * layout.scale,
                width: m.rect.width * layout.scale,
                height: m.rect.height * layout.scale,
                outline: '2px solid',
                outlineColor: 'primary.main',
                borderRadius: '2px',
                bgcolor: (t) => `color-mix(in srgb, ${(t.vars ?? t).palette.primary.main} 12%, transparent)`,
              }}
            />
          ))}
        </Box>
      )}
      {!large && capture.demo && layout && (
        <>
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              m: 'auto',
              width: 44,
              height: 44,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              bgcolor: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(2px)',
            }}
          >
            <PlayArrowRoundedIcon />
          </Box>
          <Box
            data-testid="capture-duration"
            sx={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              px: 0.75,
              py: 0.125,
              borderRadius: 0.75,
              fontSize: '0.75rem',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: '#fff',
              bgcolor: 'rgba(0,0,0,0.65)',
            }}
          >
            {formatClock(capture.durationMs)}
          </Box>
        </>
      )}
    </Box>
  )
}
