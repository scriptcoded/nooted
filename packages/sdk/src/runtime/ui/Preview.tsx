import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ReplayApi, ReplayHandle } from '../../replay/types.ts'
import { log } from '../safe.ts'
import { loadReplay } from '../preview/load-replay.ts'
import type { FrozenReport } from '../state.ts'
import { exposePreview } from '../test-hook.ts'
import { adoptCss } from './adopt-css.ts'
import { timelineSpan } from './timeline.ts'

export interface PreviewProps {
  frozen: FrozenReport
  focus?: { start: number; end: number }
  /** The preview puts its seek function here while a replayer exists (the timeline calls it with absolute times). */
  seekRef: { current: ((t: number) => void) | undefined }
}

type Status = 'loading' | 'ready' | 'unavailable'

const RRWEB_META = 4
const FALLBACK_SIZE = { width: 1280, height: 800 }
const POLL_MS = 100
const STYLE_WATCH_MS = 1000

/** The recording viewport from the first Meta event. */
function viewportOf(events: readonly { type: number; data?: unknown }[]): { width: number; height: number } {
  for (const e of events) {
    if (e.type !== RRWEB_META) continue
    const { width, height } = (e.data ?? {}) as { width?: number; height?: number }
    if (width && height && width > 0 && height > 0) return { width, height }
  }
  return FALLBACK_SIZE
}

export function Preview({ frozen, focus, seekRef }: PreviewProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [playing, setPlaying] = useState(false)
  const [styleNotice, setStyleNotice] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const api = useRef<ReplayApi | null>(null)
  const handle = useRef<ReplayHandle | null>(null)
  const playingRef = useRef(false)
  const focusRef = useRef(focus)
  focusRef.current = focus
  const watchUntil = useRef(0)
  const attempt = useRef(0)

  const span = timelineSpan(frozen)
  const base = frozen.events.length > 0 ? span.start : 0

  const setPlay = (value: boolean) => {
    playingRef.current = value
    setPlaying(value)
  }

  /** Playback range as offsets from the first event. */
  const range = (): [number, number] => {
    const duration = handle.current?.duration ?? 0
    const f = focusRef.current
    const from = f ? Math.max(0, f.start - base) : 0
    const to = f ? Math.min(duration, f.end - base) : duration
    return [from, to]
  }

  const open = () => {
    const id = ++attempt.current
    setStatus('loading')
    setStyleNotice(false)
    loadReplay().then(
      (loaded) => {
        if (attempt.current !== id) return
        api.current = loaded
        setStatus('ready')
      },
      () => {
        if (attempt.current === id) setStatus('unavailable')
      },
    )
  }

  // The preview lives in the review view, so it starts loading when it mounts and stops when it goes away.
  useEffect(() => {
    open()
    return () => {
      attempt.current++
    }
  }, [])

  // Create the replayer once the container exists; destroy it when the panel closes or the component goes away.
  useLayoutEffect(() => {
    if (status !== 'ready') return
    const box = container.current
    const loaded = api.current
    if (!box || !loaded) return
    let replayer: ReplayHandle | undefined
    let observer: ResizeObserver | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    const listening: Document[] = []
    const onViolation = (event: Event) => {
      const e = event as SecurityPolicyViolationEvent
      // Only inline <style> elements and rules matter here; style-src-attr (style="" attributes) doesn't affect the replay's sheets.
      const directive = e.effectiveDirective ?? ''
      if ((directive === 'style-src' || directive === 'style-src-elem') && Date.now() <= watchUntil.current) setStyleNotice(true)
    }
    const listen = (doc: Document | null | undefined) => {
      if (!doc || listening.includes(doc)) return
      doc.addEventListener('securitypolicyviolation', onViolation)
      listening.push(doc)
    }
    // rrweb calls document.open() on the replay document when it rebuilds a snapshot, which drops every
    // listener on it. Re-add ours after each open().
    const watchIframe = (doc: Document) => {
      const open = doc.open
      doc.open = function (this: Document, ...args: unknown[]) {
        const result = (open as (...a: unknown[]) => unknown).apply(this, args)
        doc.addEventListener('securitypolicyviolation', onViolation)
        return result
      } as typeof doc.open
      doc.addEventListener('securitypolicyviolation', onViolation)
      iframeDoc = doc
    }
    let iframeDoc: Document | undefined
    try {
      adoptCss(box.getRootNode() as ShadowRoot, loaded.css, 'replay')
      watchUntil.current = Date.now() + STYLE_WATCH_MS + 500
      listen(document)
      replayer = loaded.createReplayer(box, frozen.events as unknown[])
      handle.current = replayer
      if (replayer.iframe.contentDocument) watchIframe(replayer.iframe.contentDocument)

      const { width, height } = viewportOf(frozen.events)
      const fit = () => {
        const wrapper = replayer?.wrapper
        if (!wrapper) return
        const available = box.clientWidth
        if (available <= 0) return
        const maxHeight = Math.max(120, window.innerHeight * 0.45)
        const scale = Math.min(1, available / width, maxHeight / height)
        const offset = Math.max(0, (available - width * scale) / 2)
        wrapper.style.width = `${width}px`
        wrapper.style.height = `${height}px`
        wrapper.style.transform = `translateX(${offset}px) scale(${scale})`
        box.style.height = `${Math.ceil(height * scale)}px`
      }
      fit()
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(fit)
        observer.observe(box)
      }

      // Not autoplayed: show the last frame of the range, so what the user sees is what was captured.
      const [, to] = range()
      replayer.pause(to)

      timer = setInterval(() => {
        if (!replayer || !playingRef.current) return
        const t = replayer.getCurrentTime()
        const [from, end] = range()
        if (focusRef.current) {
          if (t >= end) {
            watchUntil.current = Date.now() + STYLE_WATCH_MS
            replayer.play(from)
          }
        } else if (t >= replayer.duration - 20) {
          replayer.pause(replayer.duration)
          setPlay(false)
        }
        exposePreview({ time: t, playing: playingRef.current, duration: replayer.duration })
      }, POLL_MS)

      seekRef.current = (t) => {
        if (!replayer) return
        const target = Math.min(replayer.duration, Math.max(0, t - base))
        setPlay(false)
        replayer.pause(target)
        exposePreview({ time: replayer.getCurrentTime(), playing: false, duration: replayer.duration })
      }
      exposePreview({ time: replayer.getCurrentTime(), playing: false, duration: replayer.duration })
    } catch (error) {
      log.warn('preview failed', error)
      try {
        replayer?.destroy()
      } catch {
        // Already broken.
      }
      replayer = undefined
      handle.current = null
      setStatus('unavailable')
    }
    return () => {
      clearInterval(timer)
      observer?.disconnect()
      for (const doc of listening) doc.removeEventListener('securitypolicyviolation', onViolation)
      iframeDoc?.removeEventListener('securitypolicyviolation', onViolation)
      seekRef.current = undefined
      handle.current = null
      playingRef.current = false
      exposePreview(undefined)
      try {
        replayer?.destroy()
      } catch (error) {
        log.warn(error)
      }
      box.replaceChildren()
      box.style.height = ''
    }
  }, [status, frozen])

  // Keep the test hook current when the user acts between polls.
  useEffect(() => {
    const r = handle.current
    if (r) exposePreview({ time: r.getCurrentTime(), playing, duration: r.duration })
  }, [playing])

  const toggle = () => {
    const r = handle.current
    if (!r) return
    if (playingRef.current) {
      r.pause()
      // Before re-rendering, so the hook never shows a poll value from before the pause.
      exposePreview({ time: r.getCurrentTime(), playing: false, duration: r.duration })
      setPlay(false)
      return
    }
    const [from, to] = range()
    const t = r.getCurrentTime()
    watchUntil.current = Date.now() + STYLE_WATCH_MS
    r.play(t >= from && t < to - 100 ? t : from)
    setPlay(true)
  }

  const showing = status === 'ready'
  return (
    <div class="preview-slot">
      <div class="preview-bar">
        {showing && (
          <button type="button" class="btn" aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={toggle}>
            {playing ? 'Pause' : 'Play'}
          </button>
        )}
        {status === 'unavailable' && <button type="button" class="btn" onClick={open}>Retry</button>}
        {status === 'loading' && <span class="preview-status" role="status">Loading preview…</span>}
      </div>
      {status === 'unavailable' && <p class="preview-status" role="status">Preview unavailable</p>}
      {showing && styleNotice && (
        <p class="preview-status" role="status">The preview may look unstyled because of this site's security policy.</p>
      )}
      {showing && <div class="preview-player" ref={container} />}
    </div>
  )
}
