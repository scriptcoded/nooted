// A capture's replay: a paused last frame, as a 96x64 thumbnail or as the large view that also plays demos.
// The replayer renders at the capture's viewport size; a Layout (scale + offset) places it in the box, and
// the same layout places the mark rectangles (rect minus scroll: the replay shows the viewport at capture.scroll).
import type { Capture } from '@nooted/shared'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ReplayApi, ReplayHandle } from '../../replay/types.ts'
import { log } from '../safe.ts'
import { adoptCss } from './adopt-css.ts'
import { endsOn, formatClock, recordingMs } from './capture-info.ts'
import { PauseIcon, PlaceholderTile, PlayIcon } from './icons.tsx'
import { isStyleViolation, watchViolations } from './style-violations.ts'
import { coverTopLayout, fitLayout, frameLayout, THUMB_H, THUMB_W, type Layout } from '@nooted/shared/frame'

export interface CapturePreviewProps {
  capture: Capture
  api: ReplayApi
  /** The larger view: taller, and demos can be played. */
  large?: boolean
  /** A style-src violation happened while the player was starting (or playing). Called at most once per mount. */
  onStyleViolation?: () => void
  /** The player couldn't be created. */
  onFail?: () => void
}

const WATCH_MS = 1500
const POLL_MS = 100
const BADGE = 18
// Context kept around the selection when the large view zooms to it.
const ZOOM_PADDING = 160

export function CapturePreview({ capture, api, large, onStyleViolation, onFail }: CapturePreviewProps) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const handle = useRef<ReplayHandle | null>(null)
  const playingRef = useRef(false)
  const watchUntil = useRef(0)
  const [layout, setLayout] = useState<(Layout & { w: number }) | null>(null)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  // Large view of a point capture with selections: zoomed to them (default) or the whole page.
  const [zoomed, setZoomed] = useState(true)
  const canZoom = !!large && !capture.demo && capture.marks.length > 0
  const zoomedRef = useRef(true)
  zoomedRef.current = canZoom && zoomed
  const placeRef = useRef<(() => void) | null>(null)
  const violation = useRef(onStyleViolation)
  violation.current = onStyleViolation
  const fail = useRef(onFail)
  fail.current = onFail

  const setPlay = (value: boolean) => {
    playingRef.current = value
    setPlaying(value)
  }

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    let replayer: ReplayHandle | undefined
    let observer: ResizeObserver | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    const unwatch: (() => void)[] = []
    const { width, height } = capture.viewport
    try {
      adoptCss(el.getRootNode() as ShadowRoot, api.css, 'replay')
      const onViolation = (event: Event) => {
        if (isStyleViolation(event) && Date.now() <= watchUntil.current) violation.current?.()
      }
      watchUntil.current = Date.now() + WATCH_MS
      unwatch.push(watchViolations(document, onViolation))
      replayer = api.createReplayer(el, capture.events as unknown[])
      handle.current = replayer
      // An iframe is transparent; a page without its own background is painted on a white canvas by browsers.
      replayer.iframe.style.background = '#fff'
      replayer.iframe.style.colorScheme = 'light'
      const doc = replayer.iframe.contentDocument
      if (doc) unwatch.push(watchViolations(doc, onViolation))

      const place = () => {
        const wrapper = replayer?.wrapper
        const frameEl = frame.current
        if (!wrapper || !frameEl) return
        let next: Layout
        let boxW = THUMB_W
        const rects = capture.marks.map((m) => ({
          x: m.rect.x - capture.scroll.x,
          y: m.rect.y - capture.scroll.y,
          width: m.rect.width,
          height: m.rect.height,
        }))
        if (large) {
          boxW = frameEl.clientWidth
          if (boxW <= 0) return
          // Leave room for the header and the controls: the picture is at most ~70 vh.
          const maxHeight = Math.max(160, Math.min(window.innerHeight * 0.7, window.innerHeight - 260))
          if (zoomedRef.current) {
            const boxH = Math.min(maxHeight, Math.round(boxW * 0.6))
            next = frameLayout(rects, width, height, boxW, boxH, ZOOM_PADDING)
            frameEl.style.height = `${boxH}px`
          } else {
            // Fit the whole viewport, up to 1:1 and the height cap; the frame is only as tall as the picture.
            const scale = Math.min(1, boxW / width, maxHeight / height)
            next = { scale, tx: (boxW - width * scale) / 2, ty: 0 }
            frameEl.style.height = `${Math.ceil(height * scale)}px`
          }
        } else {
          // Selections: framed. Whole page and recordings: fill the tile, anchored to the top.
          next = rects.length > 0 && !capture.demo ? frameLayout(rects, width, height) : coverTopLayout(width, height, THUMB_W, THUMB_H)
        }
        wrapper.style.width = `${width}px`
        wrapper.style.height = `${height}px`
        wrapper.style.transform = `translate(${next.tx}px, ${next.ty}px) scale(${next.scale})`
        setLayout((p) => (p && p.scale === next.scale && p.tx === next.tx && p.ty === next.ty && p.w === boxW ? p : { ...next, w: boxW }))
      }
      placeRef.current = place
      place()
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(place)
        observer.observe(frame.current!)
      }
      // Show the last frame, which is what the capture is.
      replayer.pause(replayer.duration)
      if (large && capture.demo) {
        timer = setInterval(() => {
          if (!replayer || !playingRef.current) return
          if (replayer.getCurrentTime() >= replayer.duration - 20) {
            replayer.pause(replayer.duration)
            setPlay(false)
          }
        }, POLL_MS)
      }
    } catch (error) {
      log.warn('capture preview failed', error)
      try {
        replayer?.destroy()
      } catch {
        // Already broken.
      }
      replayer = undefined
      handle.current = null
      setFailed(true)
      fail.current?.()
    }
    const stopWatching = setTimeout(() => unwatch.splice(0).forEach((fn) => fn()), WATCH_MS + 500)
    return () => {
      clearTimeout(stopWatching)
      placeRef.current = null
      clearInterval(timer)
      observer?.disconnect()
      unwatch.splice(0).forEach((fn) => fn())
      handle.current = null
      playingRef.current = false
      try {
        replayer?.destroy()
      } catch (error) {
        log.warn(error)
      }
      el.replaceChildren()
    }
  }, [capture, api, large])

  useLayoutEffect(() => placeRef.current?.(), [zoomed, canZoom])

  const toggle = () => {
    const r = handle.current
    if (!r) return
    if (playingRef.current) {
      r.pause()
      setPlay(false)
      return
    }
    watchUntil.current = Date.now() + WATCH_MS
    const t = r.getCurrentTime()
    r.play(t >= r.duration - 100 ? 0 : t)
    setPlay(true)
  }

  if (failed) return large ? <PlaceholderTile demo={capture.demo} large /> : null
  const { scroll } = capture
  const showMarks = layout && !playing && !(capture.demo && !large)
  return (
    <div class={`cp${large ? ' large-view' : ''}${playing ? ' playing' : ''}`}>
      <div class={large ? 'frame' : 'frame thumb'} ref={frame}>
        <div class="cp-player" ref={box} />
        {layout && showMarks && (
          <div class="cp-marks" aria-hidden="true">
            {capture.marks.map((m, i) => {
              const left = layout.tx + (m.rect.x - scroll.x) * layout.scale
              const top = layout.ty + (m.rect.y - scroll.y) * layout.scale
              const width = m.rect.width * layout.scale
              return (
                <div
                  key={i}
                  class="cp-mark"
                  data-nooted-mark=""
                  style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${m.rect.height * layout.scale}px` }}
                >
                  {large && (
                    <span
                      class="cp-badge"
                      style={{
                        left: `${Math.min(Math.max(left + width - BADGE / 2, 0), layout.w - BADGE) - left}px`,
                        top: `${Math.max(top - BADGE / 2, 0) - top}px`,
                      }}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {capture.demo && !large && (
          <>
            <span class="tile-play" aria-hidden="true">
              <svg viewBox="0 0 16 16">
                <path d="M6 4.2v7.6l6-3.8z" />
              </svg>
            </span>
            <span class="tile-dur" aria-hidden="true">{formatClock(recordingMs(capture))}</span>
          </>
        )}
      </div>
      {large && (capture.demo || canZoom) && (
        <div class="large-foot">
          {capture.demo && (
            <button type="button" class="btn play" aria-label={playing ? 'Pause demo' : 'Play demo'} onClick={toggle}>
              {playing ? <PauseIcon /> : <PlayIcon />}
              {playing ? 'Pause' : 'Play'}
            </button>
          )}
          {canZoom && (
            <button type="button" class="btn tool zoom" aria-pressed={!zoomed} onClick={() => setZoomed(!zoomed)}>
              {zoomed ? 'Show whole page' : 'Zoom to selection'}
            </button>
          )}
          {capture.demo && <span class="foot-note">{endsOn(capture)}</span>}
        </div>
      )}
    </div>
  )
}
